import ts from 'typescript';
import { TypeNode, UnionNode } from '../models';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';

export function resolveUnionType(
	type: ts.UnionType,
	typeName: string | undefined,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
	namespaces: string[],
): TypeNode {
	const { checker } = context;

	let memberTypes: ts.Type[] = type.types;
	const result: TypeNode[] = [];

	// @ts-expect-error - Internal API
	if (type.origin?.isUnion()) {
		// If a union type contains another union, `type.types` will contain the flattened types.
		// To resolve the original union type, we need to use the internal `type.origin.types`.
		// For example, given the types:
		// type U1 = string | number;
		// type U2 = U1 | boolean;
		// The `type.types` will contain [string, number, boolean], but we
		// need to resolve the original union type [U1, boolean] to get the correct type nodes.
		// `type.origin.types` will contain [U1, boolean].

		// @ts-expect-error - Internal API
		memberTypes = type.origin.types;
	}

	if (typeNode && ts.isUnionTypeNode(typeNode)) {
		// Here we're trying to match the union member types with TypeNodes
		// (what TS resolves to what was authored in code).
		// This is necessary as TS takes shortcuts when resolving types
		// and drop information about simple aliases like `type Foo = Bar;`
		// (it behaves like `Bar` doesn't exist at all).
		//
		// The matching is quite tricky, because order of `Type.members` doesn't match the order of `TypeNode.types`.
		// So instead, for every `memberType` (a Type) we look at `typeNode.types` and try to find a matching TypeNode.
		// A TypeNode is considered a match if:
		// - The TypeNode resolves to the same Type as `memberType`. This is the simplest case and covers non-generic types.
		// - The `memberType` is a closed generic of type represented by TypeNode.
		//   For example, memberType = `Array<string>` and TypeNode = `Array<T>`.

		for (const memberType of memberTypes) {
			let memberTypeNode: ts.TypeNode | undefined;

			const index = typeNode.types.findIndex((memberTypeNode) => {
				// Construct a type from the TypeNode.
				const memberTypeFromTypeNode = checker.getTypeFromTypeNode(memberTypeNode);
				return (
					memberType === memberTypeFromTypeNode ||
					isClosedGeneric(memberType, memberTypeFromTypeNode)
				);
			});

			if (index !== -1) {
				memberTypeNode = typeNode.types[index];
			}

			result.push(resolveType(memberType, memberTypeNode || typeNode, context));
		}
	} else {
		// Type is an union type, but TypeNode is not.
		// This can happen for optional properties: `foo?: T` is resolved as `T | undefined`.
		if (
			memberTypes.length === 2 &&
			memberTypes.some((x) => x.flags & ts.TypeFlags.Undefined) &&
			typeNode &&
			ts.isTypeReferenceNode(typeNode)
		) {
			// In such case propagate the parent TypeNode to the member types.
			// It will help to resolve T correctly and won't have any effect on the `undefined` type.
			for (const memberType of memberTypes) {
				result.push(resolveType(memberType, typeNode, context));
			}
		} else {
			for (const memberType of memberTypes) {
				result.push(resolveType(memberType, undefined, context));
			}
		}
	}

	return result.length === 1 ? result[0] : new UnionNode(typeName, namespaces, result);
}

function isClosedGeneric(type1: ts.Type, type2: ts.Type): boolean {
	if (!('target' in type1)) {
		return false;
	}

	return type1.target === type2 || ('target' in type2 && type1.target === type2.target);
}
