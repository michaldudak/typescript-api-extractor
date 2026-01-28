import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { ParserContext } from '../parser';
import { parseClassType } from './classParser';
import { parseFunctionType } from './functionParser';
import { parseObjectType } from './objectParser';
import { parseEnum } from './enumParser';
import {
	ObjectNode,
	TypeParameterNode,
	ArrayNode,
	ExternalTypeNode,
	IntrinsicNode,
	UnionNode,
	TupleNode,
	LiteralNode,
	IntersectionNode,
	FunctionNode,
	AnyType,
} from '../models';
import { resolveUnionType } from './unionTypeResolver';
import { getFullName } from './common';
import { TypeName } from '../models/typeName';

/**
 *
 * @param type TypeScript type to resolve
 * @param typeNode TypeScript TypeNode associated with the type, if available. It can be used to preserve the authored type name.
 * @param context Parser context containing TypeScript checker and other utilities.
 */
export function resolveType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): AnyType {
	const { checker, typeStack, includeExternalTypes } = context;

	const typeId = getTypeId(type);

	// If the typeStack contains type.id we're dealing with an object that references itself.
	// To prevent getting stuck in an infinite loop we just set it to an objectNode
	// However, we should not apply this check to intrinsic types like any/unknown/string/etc
	// as they can appear multiple times without causing infinite recursion
	const isIntrinsicType =
		(type.flags &
			(ts.TypeFlags.Any |
				ts.TypeFlags.Unknown |
				ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.Boolean |
				ts.TypeFlags.Undefined |
				ts.TypeFlags.Null |
				ts.TypeFlags.Void)) !==
		0;

	// Check for cycles before pushing to stack
	// If we're already resolving this type, return a shallow object with type info but no properties
	const shouldDetectCycles = !isIntrinsicType && typeId !== undefined;
	const isAlreadyOnStack = shouldDetectCycles && typeStack.includes(typeId);

	// Push type to stack BEFORE calling getFullName to catch cycles that occur
	// when getFullName resolves generic type arguments that may reference back to this type.
	// We track whether we pushed so we can correctly pop in the finally block.
	const shouldPushToStack = shouldDetectCycles && !isAlreadyOnStack;
	if (shouldPushToStack) {
		typeStack.push(typeId);
	}

	const typeName = getFullName(type, typeNode, context);

	// If this type was already on the stack, return a shallow version with type info but no properties
	if (isAlreadyOnStack) {
		return createShallowType(type, typeName, checker);
	}

	try {
		if (hasExactFlag(type, ts.TypeFlags.TypeParameter) && type.symbol) {
			// If we have a typeNode, check if it resolves to a more concrete type than the TypeParameter.
			// This handles cases where TypeScript doesn't fully instantiate generic parameters,
			// but the typeNode (authored code) references the actual concrete type.
			if (typeNode && ts.isTypeReferenceNode(typeNode)) {
				// Get the symbol that the type reference points to
				const symbol = checker.getSymbolAtLocation(typeNode.typeName);
				if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
					// The symbol is not a type parameter - it's a concrete type alias or interface
					// Get the type from the symbol's declaration
					const symbolType = checker.getDeclaredTypeOfSymbol(symbol);
					if (symbolType && !hasExactFlag(symbolType, ts.TypeFlags.TypeParameter)) {
						return resolveType(symbolType, typeNode, context);
					}
				}
			}

			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			const constraintType = declaration?.constraint
				? checker.getBaseConstraintOfType(type)
				: undefined;

			return new TypeParameterNode(
				type.symbol.name,
				constraintType ? resolveType(constraintType, undefined, context) : undefined,
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), undefined, context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-expect-error - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(
				type.aliasSymbol?.name
					? new TypeName(type.aliasSymbol?.name, typeName?.namespaces, typeName?.typeArguments)
					: undefined,
				resolveType(arrayType, undefined, context),
			);
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			// Determine the best name to use for this external type.
			// When a type fully resolves to an external interface (e.g., `Event` from lib.dom.d.ts),
			// TypeScript provides no aliasSymbol - the type is just the resolved interface.
			// In this case, use the resolved symbol's name (e.g., `Event`, `KeyboardEvent`).
			//
			// When a type is an external alias (e.g., `Point` from a package that wraps `{ x, y }`),
			// TypeScript preserves the aliasSymbol. Use the alias name to preserve the author's intent.
			//
			// The key insight: if there's no aliasSymbol but there is a resolved symbol from
			// node_modules, TypeScript has fully resolved the type and we should use that name.
			const resolvedSymbol = type.getSymbol();
			const resolvedSymbolName = resolvedSymbol?.getName?.();

			let externalTypeName: string | undefined;
			// If the resolved symbol is external and is a named interface (not anonymous `__type`),
			// and there's no local alias wrapping it, use the resolved interface name.
			const resolvedIsExternalInterface =
				resolvedSymbolName &&
				resolvedSymbolName !== '__type' &&
				isSymbolExternal(resolvedSymbol, checker, false) &&
				(resolvedSymbol?.flags ?? 0) & ts.SymbolFlags.Interface;

			if (resolvedIsExternalInterface && !type.aliasSymbol) {
				// Fully resolved external interface (e.g., Event, KeyboardEvent)
				externalTypeName = resolvedSymbolName;
			} else {
				// Use the authored alias name, falling back to resolved symbol name
				externalTypeName = typeName?.name || type.aliasSymbol?.getName?.() || resolvedSymbolName;
			}

			if (!externalTypeName) {
				return new IntrinsicNode('any');
			}

			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (externalTypeName === 'bivarianceHack') {
				return new ExternalTypeNode(
					new TypeName('RefCallback', ['React'], typeName?.typeArguments),
				);
			}

			return new ExternalTypeNode(
				new TypeName(externalTypeName, typeName?.namespaces, typeName?.typeArguments),
			);
		}

		if (hasExactFlag(type, ts.TypeFlags.Boolean)) {
			return new IntrinsicNode('boolean');
		}

		if (hasExactFlag(type, ts.TypeFlags.Void)) {
			return new IntrinsicNode('void');
		}

		if (includesCompositeFlag(type, ts.TypeFlags.EnumLike)) {
			let symbol = type.aliasSymbol ?? type.getSymbol();
			if ('value' in type) {
				// weird edge case - when an enum has one member only, type.getSymbol() returns the symbol of the member
				symbol = symbol?.parent;
			}

			if (!symbol) {
				return new IntrinsicNode('any');
			}

			return parseEnum(symbol, context);
		}

		if (type.isUnion()) {
			return resolveUnionType(type, typeName, typeNode, context);
		}

		if (type.isIntersection()) {
			const memberTypes: AnyType[] = [];

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, undefined, context));
			}

			if (memberTypes.length === 0) {
				throw new Error('Encountered an intersection type with no members');
			}

			if (memberTypes.length === 1) {
				return memberTypes[0];
			}

			if (memberTypes.length > 1) {
				const callSignatures = type.getCallSignatures();
				if (callSignatures.length >= 1) {
					return parseFunctionType(type, context)!;
				}

				const objectType = parseObjectType(type, typeName, context, resolveType);
				if (objectType) {
					return new IntersectionNode(typeName, memberTypes, objectType.properties);
				}

				return new IntersectionNode(typeName, memberTypes, []);
			}
		}

		if (checker.isTupleType(type)) {
			return new TupleNode(
				typeName,
				(type as ts.TupleType).typeArguments?.map((x) => resolveType(x, undefined, context)) ?? [],
			);
		}

		if (hasExactFlag(type, ts.TypeFlags.String)) {
			return new IntrinsicNode('string');
		}

		if (hasExactFlag(type, ts.TypeFlags.Number)) {
			return new IntrinsicNode('number');
		}

		if (hasExactFlag(type, ts.TypeFlags.BigInt)) {
			return new IntrinsicNode('bigint');
		}

		if (hasExactFlag(type, ts.TypeFlags.Undefined)) {
			return new IntrinsicNode('undefined');
		}

		if (hasExactFlag(type, ts.TypeFlags.Any)) {
			// Special case: if the authored typeNode is a union (e.g., `AliasedAny | undefined`),
			// we should resolve it as a union to preserve alias information,
			// even though TypeScript simplifies `any | T` to just `any` in the type system.
			if (typeNode && ts.isUnionTypeNode(typeNode)) {
				const unionTypes: AnyType[] = [];
				for (const memberTypeNode of typeNode.types) {
					// Get the type from the type node
					const memberType = checker.getTypeFromTypeNode(memberTypeNode);
					// Recursively resolve, passing the memberTypeNode so alias information is preserved
					unionTypes.push(resolveType(memberType, memberTypeNode, context));
				}
				return new UnionNode(typeName, unionTypes);
			}
			return new IntrinsicNode('any', typeName);
		}

		if (hasExactFlag(type, ts.TypeFlags.Unknown)) {
			return new IntrinsicNode('unknown', typeName);
		}

		if (includesCompositeFlag(type, ts.TypeFlags.Literal)) {
			if (type.isLiteral()) {
				return new LiteralNode(
					type.isStringLiteral() ? `"${type.value}"` : type.value,
					typeName,
					getDocumentationFromSymbol(type.symbol, checker),
				);
			}

			return new LiteralNode(checker.typeToString(type));
		}

		if (hasExactFlag(type, ts.TypeFlags.Null)) {
			return new IntrinsicNode('null');
		}

		// TODO: currently types can be either a "function" or an "object" but not both.
		// In reality, type can have both call signatures and properties.
		// Consider creating a new type that can handle both.
		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			return parseFunctionType(type, context)!;
		}

		// Check for class types (have construct signatures)
		const constructSignatures = type.getConstructSignatures();
		if (constructSignatures.length >= 1) {
			const classType = parseClassType(type, context);
			if (classType) {
				return classType;
			}
		}

		const objectType = parseObjectType(type, typeName, context, resolveType);
		if (objectType) {
			return objectType;
		}

		// Object without properties or object keyword
		if (
			hasExactFlag(type, ts.TypeFlags.Object) ||
			(hasExactFlag(type, ts.TypeFlags.NonPrimitive) && checker.typeToString(type) === 'object')
		) {
			return new ObjectNode(typeName, [], undefined);
		}

		if (hasExactFlag(type, ts.TypeFlags.Conditional)) {
			const conditionalType = type as ts.ConditionalType;
			if (conditionalType.resolvedTrueType && conditionalType.resolvedFalseType) {
				return new UnionNode(undefined, [
					// TODO: Pass TypeNode here to resolve aliases correctly
					resolveType((type as ts.ConditionalType).resolvedTrueType!, undefined, context),
					resolveType((type as ts.ConditionalType).resolvedFalseType!, undefined, context),
				]);
			} else if (conditionalType.resolvedTrueType) {
				return resolveType(conditionalType.resolvedTrueType, undefined, context);
			} else if (conditionalType.resolvedFalseType) {
				return resolveType(conditionalType.resolvedFalseType, undefined, context);
			}
		}

		console.warn(
			`Unable to handle a type with flag "${ts.TypeFlags[type.flags]}". Using any instead.`,
		);

		return new IntrinsicNode('any', typeName);
	} finally {
		// Only pop if we actually pushed
		if (shouldPushToStack) {
			typeStack.pop();
		}
	}
}

const allowedBuiltInTsTypes = new Set([
	'Pick',
	'Omit',
	'ReturnType',
	'Parameters',
	'InstanceType',
	'Partial',
	'Required',
	'Readonly',
	'Exclude',
	'Extract',
]);

const allowedBuiltInReactTypes = new Set([
	'React.NamedExoticComponent',
	'React.FC',
	'React.FunctionComponent',
	'React.ForwardRefExoticComponent',
]);

/**
 * Checks if a symbol is defined externally (in node_modules), excluding allowed built-in types.
 */
function isSymbolExternal(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
	checkAllowList: boolean = true,
): boolean {
	if (!symbol) return false;
	return (
		symbol.declarations?.some((x) => {
			const sourceFileName = x.getSourceFile().fileName;
			const definedExternally = sourceFileName.includes('node_modules');
			if (!definedExternally) return false;
			if (!checkAllowList) return true;
			return !(
				(allowedBuiltInTsTypes.has(checker.getFullyQualifiedName(symbol)) &&
					/node_modules\/typescript\/lib/.test(sourceFileName)) ||
				(allowedBuiltInReactTypes.has(checker.getFullyQualifiedName(symbol)) &&
					/node_modules\/@types\/react/.test(sourceFileName))
			);
		}) ?? false
	);
}

function isTypeExternal(type: ts.Type, checker: ts.TypeChecker): boolean {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	return isSymbolExternal(symbol, checker);
}

function hasExactFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) === flag;
}

function includesCompositeFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) !== 0;
}

function getTypeId(type: ts.Type): number | undefined {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
}

/**
 * Creates a shallow version of a type for cycle detection.
 * Returns the appropriate type node based on the type's structure, but without resolving nested types.
 */
function createShallowType(
	type: ts.Type,
	typeName: TypeName | undefined,
	checker: ts.TypeChecker,
): AnyType {
	// Check for union types
	if (type.isUnion()) {
		return new UnionNode(typeName, []);
	}

	// Check for intersection types
	if (type.isIntersection()) {
		return new IntersectionNode(typeName, [], []);
	}

	// Check for array types
	if (checker.isArrayType(type)) {
		// Return an array with 'any' as element type to avoid recursion
		return new ArrayNode(
			type.aliasSymbol?.name
				? new TypeName(type.aliasSymbol.name, typeName?.namespaces, typeName?.typeArguments)
				: undefined,
			new IntrinsicNode('any'),
		);
	}

	// Check for tuple types
	if (checker.isTupleType(type)) {
		return new TupleNode(typeName, []);
	}

	// Check for function types
	const callSignatures = type.getCallSignatures();
	if (callSignatures.length >= 1) {
		return new FunctionNode(typeName, []);
	}

	// Default to object type (interfaces, type aliases, classes, etc.)
	return new ObjectNode(typeName, [], undefined);
}

// Internal API
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
