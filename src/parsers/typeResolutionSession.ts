import ts from 'typescript';
import { IntrinsicNode, type AnyType } from '../models';
import { type TypeName } from '../models/typeName';
import { type ParserContext } from '../parser';
import { getFullName } from './common';
import { reportUnsupportedTypeFallback } from './typeResolutionDiagnostics';
import {
	type NameResolutionWarning,
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession as TypeResolutionSessionContract,
} from './typeResolutionTypes';
import { typeResolvers } from './typeResolvers';
import { createShallowType, getTypeId, hasExactFlag } from './typeResolutionUtils';
import { resolveSubstitutionFallback } from './typeResolvers/specialTypeResolvers';

const unsupportedFallbackTypes = new WeakSet<ts.Type>();

/**
 * Concrete orchestration for one public resolve call. Resolver modules own
 * individual TypeScript shapes; this session owns the cross-cutting mechanics:
 * cache keys, recursion guards, substitution probes, and warning replay.
 */
export class TypeResolutionSession implements TypeResolutionSessionContract {
	constructor(readonly context: ParserContext) {}

	/**
	 * Adapter passed to lower-level parsers that still accept a resolver callback.
	 * Reuses this session for the same ParserContext so nested resolutions share
	 * the active cache, cycle stack, substitutions, and warning interception.
	 */
	readonly resolveWithContext: ResolveTypeInContext = (type, typeNode, context) => {
		if (context === this.context) {
			return this.resolve(type, typeNode);
		}

		return new TypeResolutionSession(context).resolve(type, typeNode);
	};

	resolve(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType {
		const { resolvedTypeCache, typeStack, typeParameterSubstitutions } = this.context;

		const typeId = getTypeId(type);
		const hasTypeParameterSubstitutions = Boolean(typeParameterSubstitutions?.size);

		// Build a cache key that incorporates both the type identity and the current
		// stack depth, because shouldResolveObject / shouldInclude are depth-sensitive.
		const cacheKey = typeId !== undefined ? `${typeId}@${typeStack.length}` : undefined;

		// Check the cache first for types we've already resolved.
		// Only use cache when there's no typeNode (which can affect alias resolution)
		// and when we're not in a recursive context (type isn't already on the stack).
		if (
			cacheKey !== undefined &&
			!typeNode &&
			!hasTypeParameterSubstitutions &&
			resolvedTypeCache.has(cacheKey) &&
			!unsupportedFallbackTypes.has(type) &&
			!typeStack.includes(typeId!)
		) {
			return resolvedTypeCache.get(cacheKey)!;
		}

		const result = this.resolveUncached(type, typeNode);

		// Cache the result for future lookups when there's no typeNode influence.
		if (
			cacheKey !== undefined &&
			!typeNode &&
			!hasTypeParameterSubstitutions &&
			!unsupportedFallbackTypes.has(type) &&
			!typeStack.includes(typeId!)
		) {
			resolvedTypeCache.set(cacheKey, result);
		}

		return result;
	}

	private resolveUncached(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType {
		const { context } = this;
		const { checker, typeStack } = context;

		const typeId = getTypeId(type);

		// If the typeStack contains type.id we're dealing with an object that references itself.
		// To prevent getting stuck in an infinite loop we just set it to an objectNode
		// However, we should not apply this check to intrinsic types like any/unknown/string/etc
		// as they can appear multiple times without causing infinite recursion.
		const isIntrinsicType =
			(type.flags &
				(ts.TypeFlags.Any |
					ts.TypeFlags.Unknown |
					ts.TypeFlags.String |
					ts.TypeFlags.Number |
					ts.TypeFlags.Boolean |
					ts.TypeFlags.ESSymbol |
					ts.TypeFlags.UniqueESSymbol |
					ts.TypeFlags.Never |
					ts.TypeFlags.Undefined |
					ts.TypeFlags.Null |
					ts.TypeFlags.Void |
					ts.TypeFlags.BigInt)) !==
			0;

		// Check for cycles before pushing to stack.
		// If we're already resolving this type, return a shallow version with type info but no properties.
		const shouldDetectCycles = !isIntrinsicType && typeId !== undefined;
		const isAlreadyOnStack = shouldDetectCycles && typeStack.includes(typeId);

		// Push type to stack BEFORE calling getFullName to catch cycles that occur
		// when getFullName resolves generic type arguments that may reference back to this type.
		// We track whether we pushed so we can correctly pop in the finally block.
		const shouldPushToStack = shouldDetectCycles && !isAlreadyOnStack;
		if (shouldPushToStack) {
			typeStack.push(typeId);
		}

		let typeName: TypeName | undefined;

		try {
			// SubstitutionTypes are checker-internal placeholders created while TypeScript
			// evaluates conditional/infer/mapped types. They represent "baseType, but
			// under this constraint" rather than a syntax form we can emit directly.
			// Try this before getFullName(), which may resolve type arguments and emit
			// warnings that would be misleading if the substitution fallback succeeds.
			if (!isAlreadyOnStack && hasExactFlag(type, ts.TypeFlags.Substitution)) {
				const substitutionFallback = resolveSubstitutionFallback(type, this);
				if (substitutionFallback) {
					return substitutionFallback;
				}
			}

			const nameResolutionWarnings: NameResolutionWarning[] = [];
			if (hasExactFlag(type, ts.TypeFlags.Conditional)) {
				const onWarning = context.onWarning;
				context.onWarning = (warning) => {
					nameResolutionWarnings.push(warning);
				};
				try {
					typeName = getFullName(type, typeNode, context);
				} finally {
					context.onWarning = onWarning;
				}
			} else {
				typeName = getFullName(type, typeNode, context);
			}

			const replayNameResolutionWarnings = () => {
				for (const warning of nameResolutionWarnings) {
					context.onWarning(warning);
				}
				nameResolutionWarnings.length = 0;
			};

			// Conditional type name resolution may emit warnings for type arguments.
			// Replay them only on return paths that keep the computed typeName.
			const withNameResolutionWarnings = <T extends AnyType>(resolvedType: T): T => {
				replayNameResolutionWarnings();
				return resolvedType;
			};

			// If this type was already on the stack, return a shallow version with type info but no properties.
			if (isAlreadyOnStack) {
				return withNameResolutionWarnings(createShallowType(type, typeName, checker));
			}

			const request: TypeResolutionRequest = { type, typeNode, typeName };
			for (const resolver of typeResolvers) {
				const resolvedType = resolver.resolve(request, this);
				if (!resolvedType) {
					continue;
				}

				if (resolver.replayNameResolutionWarnings === false) {
					return resolvedType;
				}

				return withNameResolutionWarnings(resolvedType);
			}

			unsupportedFallbackTypes.add(type);
			for (const warning of nameResolutionWarnings) {
				context.onWarning(warning);
			}
			reportUnsupportedTypeFallback(type, typeNode, context);

			return new IntrinsicNode('any', typeName);
		} finally {
			// Only pop if we actually pushed.
			if (shouldPushToStack) {
				typeStack.pop();
			}
		}
	}
}
