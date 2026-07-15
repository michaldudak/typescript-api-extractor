import ts from 'typescript';
import {
	ArrayNode,
	FunctionNode,
	IntrinsicNode,
	IntersectionNode,
	ObjectNode,
	TupleNode,
	UnionNode,
	type AnyType,
} from '../models';
import { TypeName } from '../models/typeName';

/**
 * Returns true only when every bit of `flag` is set on the type. Use for flags
 * that must match exactly, as opposed to `includesCompositeFlag`.
 */
export function hasExactFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) === flag;
}

/**
 * Returns true when the type has any bit of `flag` set. Use for composite flag
 * groups such as `Literal` or `EnumLike`, where matching any member is enough.
 */
export function includesCompositeFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) !== 0;
}

/**
 * Compares checker types by mutual assignability. Most resolution matching can
 * use TypeScript's normal assignability semantics, while collapsed conditional
 * branches need `any` to match only another `any`.
 */
export function areSemanticTypesEquivalent(
	type1: ts.Type,
	type2: ts.Type,
	checker: ts.TypeChecker,
	anyPolicy: 'assignable' | 'exact' = 'assignable',
): boolean {
	if (anyPolicy === 'exact' && (type1.flags & ts.TypeFlags.Any || type2.flags & ts.TypeFlags.Any)) {
		return Boolean(type1.flags & ts.TypeFlags.Any) && Boolean(type2.flags & ts.TypeFlags.Any);
	}

	return checker.isTypeAssignableTo(type1, type2) && checker.isTypeAssignableTo(type2, type1);
}

export function getTypeId(type: ts.Type): number | undefined {
	// TypeScript keeps stable per-program type identities behind a private field.
	// The parser already depends on this internal identity for cache keys and
	// recursion detection, so the unsafe access is intentionally isolated here.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
}

/**
 * Returns the checker result of applying `keyof` to an operand. TypeScript uses
 * this method internally but does not expose it in the public TypeChecker type.
 */
export function getKeyofTypeForOperand(
	checker: ts.TypeChecker,
	operandType: ts.Type,
): ts.Type | undefined {
	const checkerWithIndexType = checker as ts.TypeChecker & {
		getIndexType?: (type: ts.Type) => ts.Type;
	};
	return checkerWithIndexType.getIndexType?.(operandType);
}

/**
 * Creates a shallow type node for cycle detection. The result keeps the outer
 * type identity but does not resolve nested members, preventing recursive
 * object/array/function types from expanding forever.
 */
export function createShallowType(
	type: ts.Type,
	typeName: TypeName | undefined,
	checker: ts.TypeChecker,
): AnyType {
	if (type.isUnion()) {
		return new UnionNode(typeName, []);
	}

	if (type.isIntersection()) {
		return new IntersectionNode(typeName, [], []);
	}

	if (checker.isArrayType(type)) {
		return new ArrayNode(
			type.aliasSymbol?.name
				? new TypeName(type.aliasSymbol.name, typeName?.namespaces, typeName?.typeArguments)
				: undefined,
			new IntrinsicNode('any'),
			isReadonlyArrayType(type) ? true : undefined,
		);
	}

	if (checker.isTupleType(type)) {
		return new TupleNode(typeName, [], isReadonlyTupleType(type) ? true : undefined);
	}

	if (type.getCallSignatures().length >= 1) {
		return new FunctionNode(typeName, []);
	}

	return new ObjectNode(typeName, [], undefined);
}

function isReadonlyArrayType(type: ts.Type): boolean {
	const targetSymbol =
		type.flags & ts.TypeFlags.Object && 'target' in type
			? (type as ts.TypeReference).target.symbol
			: undefined;
	return (
		targetSymbol?.name === 'ReadonlyArray' &&
		Boolean(
			targetSymbol.declarations?.some((declaration) =>
				/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
			),
		)
	);
}

function isReadonlyTupleType(type: ts.Type): boolean {
	return 'target' in type && Boolean((type as ts.TupleTypeReference).target.readonly);
}

// Internal TypeScript API used when enum literal types point at a member symbol
// and the parser needs to recover the parent enum symbol.
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
