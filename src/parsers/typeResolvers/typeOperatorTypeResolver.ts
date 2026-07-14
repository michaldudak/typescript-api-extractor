import ts from 'typescript';
import {
	IntrinsicNode,
	LiteralNode,
	ObjectNode,
	TypeOperatorNode,
	UnionNode,
	type AnyType,
} from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getKeyofTypeOperatorNode } from './typeOperatorTypeNodes';

// Type operators are syntax-first: concrete `keyof Foo` may already be exposed
// by TypeScript as a literal, intrinsic, or literal union, so this resolver must
// run before broad value-shape resolvers.

export function resolveTypeOperatorType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (!operatorNode) {
		return undefined;
	}

	const operandType = session.context.checker.getTypeFromTypeNode(operatorNode.type);
	const undefinedMember = getUndefinedUnionMember(type);
	const typeOperatorNode = new TypeOperatorNode(
		typeName,
		'keyof',
		compactTypeOperatorOperand(session.resolve(operandType, operatorNode.type)),
		resolveTypeOperatorResult(type, session, { excludeUndefined: Boolean(undefinedMember) }),
	);

	if (!undefinedMember) {
		return typeOperatorNode;
	}

	return new UnionNode(undefined, [typeOperatorNode, new IntrinsicNode('undefined')]);
}

function resolveTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	options: { excludeUndefined?: boolean } = {},
): AnyType {
	if (type.isUnion()) {
		const memberTypes = options.excludeUndefined
			? type.types.filter((memberType) => !isUndefinedType(memberType))
			: type.types;

		if (memberTypes.length === 1) {
			return resolveTypeOperatorResult(memberTypes[0], session);
		}

		return new UnionNode(
			undefined,
			memberTypes.map((memberType) => session.resolve(memberType, undefined)),
		);
	}

	const concreteResult = resolveConcreteTypeOperatorResult(type);
	if (concreteResult) {
		return concreteResult;
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint && baseConstraint !== type) {
		return resolveTypeOperatorResult(baseConstraint, session);
	}

	return new IntrinsicNode('any');
}

function resolveConcreteTypeOperatorResult(type: ts.Type): AnyType | undefined {
	if ((type.flags & ts.TypeFlags.Never) !== 0) {
		return new IntrinsicNode('never');
	}

	if ((type.flags & ts.TypeFlags.String) !== 0) {
		return new IntrinsicNode('string');
	}

	if ((type.flags & ts.TypeFlags.Number) !== 0) {
		return new IntrinsicNode('number');
	}

	if (
		(type.flags & ts.TypeFlags.ESSymbol) !== 0 ||
		(type.flags & ts.TypeFlags.UniqueESSymbol) !== 0
	) {
		return new IntrinsicNode('symbol');
	}

	if (type.isLiteral()) {
		return new LiteralNode(type.isStringLiteral() ? `"${type.value}"` : type.value);
	}

	return undefined;
}

function compactTypeOperatorOperand(type: AnyType): AnyType {
	if (type instanceof ObjectNode && type.typeName) {
		return new ObjectNode(type.typeName, [], undefined, type.indexSignature);
	}

	return type;
}

function getUndefinedUnionMember(type: ts.Type): ts.Type | undefined {
	if (!type.isUnion()) {
		return undefined;
	}

	return type.types.find(isUndefinedType);
}

function isUndefinedType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Undefined) !== 0;
}
