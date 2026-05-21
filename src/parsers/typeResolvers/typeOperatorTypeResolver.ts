import ts from 'typescript';
import { IntrinsicNode, ObjectNode, TypeOperatorNode, UnionNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';

// Type operators are syntax-first: concrete `keyof Foo` may already be exposed
// by TypeScript as a literal union, so this resolver must run before `union`.

export function resolveTypeOperatorType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (
		!typeNode ||
		!ts.isTypeOperatorNode(typeNode) ||
		typeNode.operator !== ts.SyntaxKind.KeyOfKeyword
	) {
		return undefined;
	}

	const operandType = session.context.checker.getTypeFromTypeNode(typeNode.type);
	const operatorType = session.context.checker.getTypeFromTypeNode(typeNode);
	const typeOperatorNode = new TypeOperatorNode(
		typeName,
		'keyof',
		compactTypeOperatorOperand(session.resolve(operandType, typeNode.type)),
		resolveTypeOperatorResult(operatorType, session),
	);
	const undefinedMember = getUndefinedUnionMember(type);

	if (!undefinedMember) {
		return typeOperatorNode;
	}

	return new UnionNode(undefined, [typeOperatorNode, new IntrinsicNode('undefined')]);
}

function resolveTypeOperatorResult(type: ts.Type, session: TypeResolutionSession): AnyType {
	if (type.isUnion()) {
		return new UnionNode(
			undefined,
			type.types.map((memberType) => session.resolve(memberType, undefined)),
		);
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint) {
		return session.resolve(baseConstraint, undefined);
	}

	return new IntrinsicNode('any');
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

	return type.types.find((memberType) => (memberType.flags & ts.TypeFlags.Undefined) !== 0);
}
