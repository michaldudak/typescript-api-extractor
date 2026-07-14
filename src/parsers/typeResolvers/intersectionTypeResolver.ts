import ts from 'typescript';
import { IntersectionNode, ObjectNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { resolveCallableType } from './functionTypeResolver';
import { resolveObjectLikeType } from './objectTypeResolver';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import {
	containsKeyofTypeOperator,
	flattenIntersectionTypeNodes,
	getKeyofTypeOperatorNode,
} from './typeOperatorTypeNodes';
import { getKeyofResultTypeFromSyntax } from './typeOperatorTypeResolver';

// Intersection handling stays separate because it composes several
// other type classes. It preserves explicit intersection members, then asks the
// function/object resolvers for any merged shape TypeScript exposes.

export function resolveIntersectionType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!type.isIntersection()) {
		return undefined;
	}

	const memberTypeNodes = getIntersectionMemberTypeNodes(typeNode);
	const matchedMemberTypeNodes = matchIntersectionMemberTypeNodes(
		type.types,
		memberTypeNodes,
		session,
	);
	const memberTypes = type.types.map((memberType, index) => {
		const memberTypeNode = matchedMemberTypeNodes?.[index];
		return session.resolve(
			memberType,
			containsKeyofTypeOperator(memberTypeNode) ? memberTypeNode : undefined,
		);
	});

	if (memberTypes.length === 0) {
		throw new Error('Encountered an intersection type with no members');
	}

	if (memberTypes.length === 1) {
		return memberTypes[0];
	}

	const callSignatures = type.getCallSignatures();
	if (callSignatures.length >= 1) {
		return resolveCallableType({ type, typeName, typeNode: undefined }, session)!;
	}

	const objectType = resolveObjectLikeType({ type, typeName, typeNode: undefined }, session);
	if (objectType instanceof ObjectNode) {
		return new IntersectionNode(typeName, memberTypes, objectType.properties);
	}

	return new IntersectionNode(typeName, memberTypes, []);
}

function getIntersectionMemberTypeNodes(
	typeNode: ts.TypeNode | undefined,
): readonly ts.TypeNode[] | undefined {
	return typeNode ? flattenIntersectionTypeNodes(typeNode) : undefined;
}

function matchIntersectionMemberTypeNodes(
	memberTypes: readonly ts.Type[],
	memberTypeNodes: readonly ts.TypeNode[] | undefined,
	session: TypeResolutionSession,
): readonly (ts.TypeNode | undefined)[] | undefined {
	if (!memberTypeNodes) {
		return undefined;
	}

	const usedNodeIndexes = new Set<number>();
	return memberTypes.map((memberType) => {
		let nodeIndex = memberTypeNodes.findIndex(
			(node, index) =>
				!usedNodeIndexes.has(index) &&
				typesAreEquivalent(memberType, getTypeForIntersectionMemberNode(node, session), session),
		);
		if (nodeIndex === -1) {
			nodeIndex = memberTypeNodes.findIndex((_, index) => !usedNodeIndexes.has(index));
		}
		if (nodeIndex === -1) {
			return undefined;
		}

		usedNodeIndexes.add(nodeIndex);
		return memberTypeNodes[nodeIndex];
	});
}

function getTypeForIntersectionMemberNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
): ts.Type {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (operatorNode) {
		return getKeyofResultTypeFromSyntax(operatorNode, session.context);
	}

	const type = session.context.checker.getTypeFromTypeNode(typeNode);
	const substitutions = session.context.typeParameterSubstitutions;
	return substitutions ? substituteTypeParameter(type, substitutions) : type;
}

function typesAreEquivalent(
	type1: ts.Type,
	type2: ts.Type,
	session: TypeResolutionSession,
): boolean {
	const { checker } = session.context;
	return checker.isTypeAssignableTo(type1, type2) && checker.isTypeAssignableTo(type2, type1);
}
