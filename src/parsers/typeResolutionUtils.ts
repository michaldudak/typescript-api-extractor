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

export function hasExactFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) === flag;
}

export function includesCompositeFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) !== 0;
}

export function getTypeId(type: ts.Type): number | undefined {
	// TypeScript keeps stable per-program type identities behind a private field.
	// The parser already depends on this internal identity for cache keys and
	// recursion detection, so the unsafe access is intentionally isolated here.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
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
		);
	}

	if (checker.isTupleType(type)) {
		return new TupleNode(typeName, []);
	}

	if (type.getCallSignatures().length >= 1) {
		return new FunctionNode(typeName, []);
	}

	return new ObjectNode(typeName, [], undefined);
}

// Internal TypeScript API used when enum literal types point at a member symbol
// and the parser needs to recover the parent enum symbol.
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
