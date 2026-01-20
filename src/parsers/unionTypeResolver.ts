import ts from 'typescript';
import { AnyType, UnionNode } from '../models';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';
import { TypeName } from '../models/typeName';

/**
 * Flattens nested union TypeNodes to match how TypeScript flattens Types.
 * For example: `(string | ((state: State) => string | undefined)) | undefined`
 * The TypeNode has 2 members but TypeScript flattens the Types to 3 members.
 * This function recursively flattens nested unions while unwrapping parenthesized types.
 */
function flattenUnionTypeNode(typeNode: ts.UnionTypeNode): ts.TypeNode[] {
	const result: ts.TypeNode[] = [];

	for (const member of typeNode.types) {
		// Unwrap parenthesized types like `(string | number)`
		let unwrapped = member;
		while (ts.isParenthesizedTypeNode(unwrapped)) {
			unwrapped = unwrapped.type;
		}

		// If the unwrapped type is a union, recursively flatten it
		if (ts.isUnionTypeNode(unwrapped)) {
			result.push(...flattenUnionTypeNode(unwrapped));
		} else {
			result.push(member);
		}
	}

	return result;
}

export function resolveUnionType(
	type: ts.UnionType,
	typeName: TypeName | undefined,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): AnyType {
	const { checker } = context;

	let memberTypes: ts.Type[] = type.types;
	const result: AnyType[] = [];

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

	// If there's no provided type node or it's is not a union,
	// We check if the type declaration is an alias.
	// If so, it can point to the original union type.
	//
	// For example:
	// function f(x: Params) {}
	// type Params = SomeType | SomeOtherType;
	//
	// In this case `typeNode` will be set to the type reference of the function parameter,
	// so we extract the needed union definition.
	const typeAliasDeclaration = type.aliasSymbol?.declarations?.[0];
	if (
		(!typeNode || !ts.isUnionTypeNode(typeNode)) &&
		typeAliasDeclaration &&
		ts.isTypeAliasDeclaration(typeAliasDeclaration) &&
		ts.isUnionTypeNode(typeAliasDeclaration.type)
	) {
		typeNode = typeAliasDeclaration.type;
	}

	if (typeNode && ts.isUnionTypeNode(typeNode)) {
		// Match union member types with TypeNodes (what TS resolves to what was authored in code).
		// This is necessary as TS takes shortcuts when resolving types and drops information
		// about simple aliases like `type Foo = Bar;` (it behaves like `Bar` doesn't exist).
		//
		// A TypeNode is considered a match for a memberType if:
		// - The TypeNode resolves to the same Type as `memberType`. This is the simplest case.
		// - The `memberType` is a closed generic of type represented by TypeNode.
		//   For example, memberType = `Array<string>` and TypeNode = `Array<T>`.

		// Flatten nested unions in the TypeNode to match how TypeScript flattens the Types
		const flattenedTypeNodes = flattenUnionTypeNode(typeNode);

		// Match each TypeNode to a memberType and resolve in source order
		const usedMemberTypes = new Set<ts.Type>();

		for (const node of flattenedTypeNodes) {
			const nodeType = checker.getTypeFromTypeNode(node);

			// Special case: boolean TypeNode matches both false and true literal types
			// TypeScript expands `boolean` to `false | true` in union types
			// We need to mark ALL boolean literals as used since they correspond to a single boolean TypeNode
			const isBooleanNode = (nodeType.flags & ts.TypeFlags.Boolean) !== 0;

			if (isBooleanNode) {
				// Mark all boolean literal memberTypes as used
				let foundBooleanLiteral = false;
				for (const memberType of memberTypes) {
					if ((memberType.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
						usedMemberTypes.add(memberType);
						foundBooleanLiteral = true;
					}
				}
				if (foundBooleanLiteral) {
					// Resolve as the boolean TypeNode (not the individual literals)
					result.push(resolveType(nodeType, node, context));
					continue;
				}
			}

			// Find a matching memberType for this TypeNode
			let matchedMemberType: ts.Type | undefined;

			for (const memberType of memberTypes) {
				if (usedMemberTypes.has(memberType)) {
					continue;
				}

				// Check for direct match or closed generic
				if (memberType === nodeType || isClosedGeneric(memberType, nodeType)) {
					matchedMemberType = memberType;
					break;
				}
			}

			if (matchedMemberType) {
				usedMemberTypes.add(matchedMemberType);
				result.push(resolveType(matchedMemberType, node, context));
			}
			// If no matching memberType found, skip this TypeNode.
			// The unmatched memberType will be added at the end.
		}

		// Add any memberTypes that weren't matched to a TypeNode
		// This handles cases like optional properties where TypeScript adds `undefined`
		// to the union but there's no corresponding TypeNode for it
		for (const memberType of memberTypes) {
			if (!usedMemberTypes.has(memberType)) {
				result.push(resolveType(memberType, undefined, context));
			}
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

	const typeNameToUse = typeName?.name ? typeName : undefined;

	return result.length === 1 ? result[0] : new UnionNode(typeNameToUse, result);
}

function isClosedGeneric(type1: ts.Type, type2: ts.Type): boolean {
	if (!('target' in type1)) {
		return false;
	}

	return type1.target === type2 || ('target' in type2 && type1.target === type2.target);
}
