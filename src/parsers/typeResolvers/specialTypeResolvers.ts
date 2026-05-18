import ts from 'typescript';
import { IntrinsicNode, TypeParameterNode, UnionNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';

// Special resolvers cover TypeScript-internal or context-sensitive
// shapes that do not map directly to one public model node. They either
// substitute a more concrete type, or intentionally fall back to `any` for
// unsupported internals.

export function resolveTypeParameterType(
	{ type, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker, typeParameterSubstitutions } = session.context;

	if (!hasExactFlag(type, ts.TypeFlags.TypeParameter) || !type.symbol) {
		return undefined;
	}

	const substitution = typeParameterSubstitutions?.get(type.symbol);
	if (
		substitution &&
		substitution !== type &&
		(!(substitution.flags & ts.TypeFlags.TypeParameter) || substitution.symbol !== type.symbol)
	) {
		return session.resolve(substitution, undefined);
	}

	// If we have a typeNode, check if it resolves to a more concrete type than the TypeParameter.
	// This handles cases where TypeScript doesn't fully instantiate generic parameters,
	// but the typeNode (authored code) references the actual concrete type.
	if (typeNode && ts.isTypeReferenceNode(typeNode)) {
		const symbol = checker.getSymbolAtLocation(typeNode.typeName);
		if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
			const symbolType = checker.getDeclaredTypeOfSymbol(symbol);
			if (symbolType && !hasExactFlag(symbolType, ts.TypeFlags.TypeParameter)) {
				return session.resolve(symbolType, typeNode);
			}
		}
	}

	const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
	const constraintType = declaration?.constraint
		? checker.getBaseConstraintOfType(type)
		: undefined;

	return new TypeParameterNode(
		type.symbol.name,
		constraintType ? session.resolve(constraintType, undefined) : undefined,
		declaration?.default
			? session.resolve(checker.getTypeAtLocation(declaration.default), undefined)
			: undefined,
	);
}

export function resolveConditionalType(
	{ type }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.Conditional)) {
		return undefined;
	}

	const conditionalType = type as ts.ConditionalType;
	if (conditionalType.resolvedTrueType && conditionalType.resolvedFalseType) {
		return new UnionNode(undefined, [
			// TODO: Pass TypeNode here to resolve aliases correctly.
			session.resolve(conditionalType.resolvedTrueType, undefined),
			session.resolve(conditionalType.resolvedFalseType, undefined),
		]);
	} else if (conditionalType.resolvedTrueType) {
		return session.resolve(conditionalType.resolvedTrueType, undefined);
	} else if (conditionalType.resolvedFalseType) {
		return session.resolve(conditionalType.resolvedFalseType, undefined);
	}

	return undefined;
}

export function resolveIndexLikeType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.Index) && !hasExactFlag(type, ts.TypeFlags.IndexedAccess)) {
		return undefined;
	}

	// Index (keyof T) and IndexedAccess (T[K]) types can't be represented directly.
	// Expand them via getBaseConstraintOfType to a representable form.
	// When the base constraint is unavailable (e.g., T[K] with unresolved type parameters),
	// fall back to 'any' silently. This is an expected limitation, not a parser bug.
	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint) {
		return session.resolve(baseConstraint, undefined);
	}

	return new IntrinsicNode('any', typeName);
}

export function resolveSubstitutionFallback(
	type: ts.Type,
	session: TypeResolutionSession,
): AnyType | undefined {
	const substitutionType = type as ts.SubstitutionType;

	return (
		resolveSubstitutionCandidate(substitutionType.baseType, session) ??
		resolveSubstitutionCandidate(substitutionType.constraint, session)
	);
}

function resolveSubstitutionCandidate(
	candidateType: ts.Type,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (hasExactFlag(candidateType, ts.TypeFlags.Substitution)) {
		return undefined;
	}

	// This is a probe, not the real fallback path. If the candidate still needs
	// an unsupported-type warning, reject it and let the original substitution
	// report a single warning with the best source location.
	const warnings: unknown[] = [];
	const { context } = session;
	const onWarning = context.onWarning;
	context.onWarning = (warning) => {
		warnings.push(warning);
	};

	try {
		const resolvedCandidate = session.resolve(candidateType, undefined);
		return warnings.length === 0 && !isAnyNode(resolvedCandidate) ? resolvedCandidate : undefined;
	} finally {
		context.onWarning = onWarning;
	}
}

function isAnyNode(typeNode: AnyType): boolean {
	return typeNode instanceof IntrinsicNode && typeNode.intrinsic === 'any' && !typeNode.typeName;
}
