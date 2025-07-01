import ts from 'typescript';
import { TypeNode, UnionNode } from '../models';
import { getTypeName } from './common';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';

export function resolveUnionType(
	type: ts.UnionType,
	typeSymbol: ts.Symbol | undefined,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
	namespaces: string[],
): TypeNode {
	const { checker } = context;
	let memberTypes: ts.Type[] = type.types;
	const parsedMemberTypes: TypeNode[] = [];
	const typeName = getTypeName(type, typeSymbol, checker, false);

	// @ts-expect-error - Internal API
	if (type.origin?.isUnion()) {
		// @ts-expect-error - Internal API

		// If a union type contains another union, `type.types` will contain the flattened types.
		// To resolve the original union type, we need to use the internal `type.origin.types`.
		memberTypes = type.origin.types;
	}

	if (typeNode && ts.isUnionTypeNode(typeNode)) {
		for (const memberType of memberTypes) {
			let memberTypeNode: ts.TypeNode | undefined;

			// If the typeNode is a union type, we need to find the corresponding member
			// type node for the current member type.

			const index = typeNode.types.findIndex((memberTypeNode) => {
				const memberTypeFromTypeNode = checker.getTypeFromTypeNode(memberTypeNode);
				return (
					memberType === memberTypeFromTypeNode ||
					('target' in memberType &&
						memberType.target != undefined &&
						(('target' in memberTypeFromTypeNode &&
							memberType.target === memberTypeFromTypeNode.target) ||
							memberType.target === memberTypeFromTypeNode))
				);
			});

			if (index !== -1) {
				memberTypeNode = typeNode.types[index];
			}

			parsedMemberTypes.push(resolveType(memberType, context, memberTypeNode || typeNode));
		}
	} else {
		// `type` is an union type, but `typeNode` is not.
		// This could happen for optional properties: `foo?: T` is resolved as `T | undefined`.
		if (
			memberTypes.length === 2 &&
			memberTypes.some((x) => x.flags & ts.TypeFlags.Undefined) &&
			typeNode &&
			ts.isTypeReferenceNode(typeNode)
		) {
			for (const memberType of memberTypes) {
				parsedMemberTypes.push(resolveType(memberType, context, typeNode));
			}
		} else {
			for (const memberType of memberTypes) {
				parsedMemberTypes.push(resolveType(memberType, context));
			}
		}
	}

	return parsedMemberTypes.length === 1
		? parsedMemberTypes[0]
		: new UnionNode(typeName, namespaces, parsedMemberTypes);
}
