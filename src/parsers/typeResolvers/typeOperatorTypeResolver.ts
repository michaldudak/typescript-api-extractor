import ts from 'typescript';
import {
	IntrinsicNode,
	LiteralNode,
	ObjectNode,
	TypeOperatorNode,
	TypeQueryNode,
	UnionNode,
	type AnyType,
	type TypeOperatorResolutionKind,
} from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { getFullName } from '../common';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getKeyofTypeForOperand } from '../typeResolutionUtils';
import { resolveExternalType } from './externalTypeResolver';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import { canResolveObjectTypeShallowly, resolveShallowObjectLikeType } from './objectTypeResolver';
import {
	containsKeyofTypeOperator,
	getKeyofTypeOperatorNode,
	unwrapParenthesizedTypeNode,
} from './typeOperatorTypeNodes';

// Type operators are syntax-first: concrete `keyof Foo` may already be exposed
// by TypeScript as a literal, intrinsic, or literal union, so this resolver must
// run before broad value-shape resolvers.

export function resolveTypeOperatorType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (!operatorNode) {
		return resolveCollapsedTypeOperatorUnion(typeNode, typeName, session);
	}

	const operandType = session.context.checker.getTypeFromTypeNode(operatorNode.type);
	const undefinedMember = getUndefinedUnionMember(type);
	const collapsedToUndefined = isUndefinedType(type);
	const resultType =
		collapsedToUndefined || session.context.typeParameterSubstitutions?.size
			? getKeyofResultTypeFromSyntax(operatorNode, session.context)
			: type;
	const resolvedResult = resolveTypeOperatorResult(resultType, session, {
		excludeUndefined: Boolean(undefinedMember),
		typeName,
	});
	const typeOperatorNode = new TypeOperatorNode(
		undefined,
		'keyof',
		resolveTypeOperatorOperand(operandType, operatorNode.type, session),
		resolvedResult.type,
		resolvedResult.resolutionKind,
	);

	if (!undefinedMember && !collapsedToUndefined) {
		return typeOperatorNode;
	}

	return new UnionNode(undefined, [typeOperatorNode, new IntrinsicNode('undefined')]);
}

export function getKeyofResultTypeFromSyntax(
	operatorNode: ts.TypeOperatorNode,
	context: ScopedParserContext,
): ts.Type {
	const { checker, typeParameterSubstitutions } = context;
	const operandType = checker.getTypeFromTypeNode(operatorNode.type);
	const substitutedOperand = typeParameterSubstitutions
		? substituteTypeParameter(operandType, typeParameterSubstitutions)
		: operandType;
	return (
		getKeyofTypeForOperand(checker, substitutedOperand) ?? checker.getTypeFromTypeNode(operatorNode)
	);
}

function resolveCollapsedTypeOperatorUnion(
	typeNode: ts.TypeNode | undefined,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isUnionTypeNode(unwrapped) || !containsKeyofTypeOperator(unwrapped)) {
		return undefined;
	}

	return new UnionNode(
		typeName,
		unwrapped.types.map((memberTypeNode) => {
			const operatorNode = getKeyofTypeOperatorNode(memberTypeNode);
			const memberType = operatorNode
				? getKeyofResultTypeFromSyntax(operatorNode, session.context)
				: session.context.checker.getTypeFromTypeNode(memberTypeNode);
			return session.resolve(memberType, memberTypeNode);
		}),
	);
}

function resolveTypeOperatorOperand(
	type: ts.Type,
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
): AnyType {
	const unwrappedTypeNode = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isTypeQueryNode(unwrappedTypeNode)) {
		return new TypeQueryNode(unwrappedTypeNode.exprName.getText());
	}
	if (ts.isImportTypeNode(unwrappedTypeNode) && unwrappedTypeNode.isTypeOf) {
		return new TypeQueryNode(unwrappedTypeNode.getText().replace(/^typeof\s+/, ''));
	}

	if (canResolveObjectTypeShallowly(type, session.context.checker)) {
		const request: TypeResolutionRequest = {
			type,
			typeNode,
			typeName: getFullName(type, typeNode, session.context),
		};
		const externalType = resolveExternalType(request, session);
		if (externalType) {
			return externalType;
		}

		const shallowObject = resolveShallowObjectLikeType(request, session);
		if (shallowObject) {
			return shallowObject;
		}
	}

	return compactTypeOperatorOperand(session.resolve(type, typeNode));
}

function resolveTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	options: { excludeUndefined?: boolean; typeName?: TypeResolutionRequest['typeName'] } = {},
): { type: AnyType; resolutionKind: TypeOperatorResolutionKind } {
	if (type.isUnion()) {
		const memberTypes = options.excludeUndefined
			? type.types.filter((memberType) => !isUndefinedType(memberType))
			: type.types;

		if (memberTypes.length === 1) {
			return resolveTypeOperatorResult(memberTypes[0], session, { typeName: options.typeName });
		}

		return {
			type: new UnionNode(
				options.typeName,
				memberTypes.map((memberType) => session.resolve(memberType, undefined)),
			),
			resolutionKind: 'exact',
		};
	}

	const concreteResult = resolveConcreteTypeOperatorResult(type, session, options.typeName);
	if (concreteResult) {
		return { type: concreteResult, resolutionKind: 'exact' };
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint && baseConstraint !== type) {
		const resolvedConstraint = resolveTypeOperatorResult(baseConstraint, session, {
			typeName: options.typeName,
		});
		return {
			type: resolvedConstraint.type,
			resolutionKind:
				resolvedConstraint.resolutionKind === 'fallback' ? 'fallback' : 'baseConstraint',
		};
	}

	return { type: new IntrinsicNode('any'), resolutionKind: 'fallback' };
}

function resolveConcreteTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	typeName: TypeResolutionRequest['typeName'],
): AnyType | undefined {
	if ((type.flags & ts.TypeFlags.Never) !== 0) {
		return new IntrinsicNode('never', typeName);
	}

	if ((type.flags & ts.TypeFlags.String) !== 0) {
		return new IntrinsicNode('string', typeName);
	}

	if ((type.flags & ts.TypeFlags.Number) !== 0) {
		return new IntrinsicNode('number', typeName);
	}

	if ((type.flags & ts.TypeFlags.UniqueESSymbol) !== 0) {
		return session.resolve(type, undefined);
	}

	if ((type.flags & ts.TypeFlags.ESSymbol) !== 0) {
		return new IntrinsicNode('symbol', typeName);
	}

	if (type.isLiteral()) {
		return new LiteralNode(type.isStringLiteral() ? `"${type.value}"` : type.value, typeName);
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
