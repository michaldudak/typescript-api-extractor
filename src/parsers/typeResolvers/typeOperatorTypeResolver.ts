import ts from 'typescript';
import {
	IntersectionNode,
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
import { reportUnsupportedTypeFallback } from '../typeResolutionDiagnostics';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getKeyofTypeForOperand, getTypeId } from '../typeResolutionUtils';
import { isExternalTypeNode, resolveExternalType } from './externalTypeResolver';
import { resolveAuthoredKeyofAlias } from './authoredTypeAlias';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import { canResolveObjectTypeShallowly, resolveShallowObjectLikeType } from './objectTypeResolver';
import {
	containsKeyofTypeOperatorOrAlias,
	flattenIntersectionTypeNodes,
	getIndexedAccessKeyofSourceTypeNode,
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
	if (
		!session.context.includeExternalTypes &&
		isExternalTypeNode(typeNode, session.context.checker)
	) {
		return undefined;
	}
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (!operatorNode) {
		return resolveCollapsedTypeOperatorSyntax(type, typeNode, typeName, session);
	}

	const operandType = session.context.checker.getTypeFromTypeNode(operatorNode.type);
	const undefinedMember = getUndefinedUnionMember(type);
	const collapsedToUndefined = isUndefinedType(type);
	const shouldRecomputeInstantiatedResult =
		session.context.typeParameterSubstitutions?.size && !isConcreteKeyofResultType(type);
	const resultType =
		collapsedToUndefined || shouldRecomputeInstantiatedResult
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

function resolveCollapsedTypeOperatorSyntax(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		const sourceTypeNode = getIndexedAccessKeyofSourceTypeNode(unwrapped, session.context.checker);
		if (sourceTypeNode) {
			const substitutions = getIndexedAccessTypeParameterSubstitutions(unwrapped, session);
			const resolveSource = () => resolveAuthoredTypeNode(sourceTypeNode, session, type);
			return substitutions
				? session.context.runWithTypeParameterSubstitutionScope(substitutions, resolveSource)
				: resolveSource();
		}
	}
	if (
		!containsKeyofTypeOperatorOrAlias(
			unwrapped,
			session.context.checker,
			new Set(),
			session.context.includeExternalTypes,
		)
	) {
		return undefined;
	}
	if (ts.isUnionTypeNode(unwrapped)) {
		return resolveAuthoredUnion(type, unwrapped, typeName, session);
	}
	if (ts.isIntersectionTypeNode(unwrapped) && !type.isIntersection()) {
		return resolveAuthoredIntersection(unwrapped, typeName, session);
	}
	if (ts.isConditionalTypeNode(unwrapped) && (type.flags & ts.TypeFlags.Conditional) === 0) {
		return resolveCollapsedConditional(type, unwrapped, typeName, session);
	}
	return undefined;
}

function getIndexedAccessTypeParameterSubstitutions(
	typeNode: ts.IndexedAccessTypeNode,
	session: TypeResolutionSession,
): Map<ts.Symbol, ts.Type> | undefined {
	const { checker, typeParameterSubstitutions } = session.context;
	const objectType = checker.getTypeFromTypeNode(typeNode.objectType);
	if (!(objectType.flags & ts.TypeFlags.Object) || !('target' in objectType)) {
		return undefined;
	}

	const reference = objectType as ts.TypeReference;
	const typeParameters = (reference.target as ts.GenericType).typeParameters;
	const typeArguments = checker.getTypeArguments(reference);
	if (!typeParameters?.length || !typeArguments.length) {
		return undefined;
	}

	const substitutions = new Map(typeParameterSubstitutions);
	for (let index = 0; index < typeParameters.length; index += 1) {
		const parameter = typeParameters[index];
		const argument = typeArguments[index];
		if (parameter.symbol && argument) {
			substitutions.set(parameter.symbol, argument);
		}
	}
	return substitutions.size > 0 ? substitutions : undefined;
}

function resolveAuthoredUnion(
	type: ts.Type,
	typeNode: ts.UnionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): UnionNode {
	return new UnionNode(
		typeName,
		typeNode.types.map((memberTypeNode) =>
			resolveAuthoredTypeNode(
				memberTypeNode,
				session,
				getCollapsedUnionOperatorResult(type, memberTypeNode, typeNode, session),
			),
		),
	);
}

function getCollapsedUnionOperatorResult(
	type: ts.Type,
	memberTypeNode: ts.TypeNode,
	unionTypeNode: ts.UnionTypeNode,
	session: TypeResolutionSession,
): ts.Type | undefined {
	if (
		!session.context.typeParameterSubstitutions?.size ||
		!getKeyofTypeOperatorNode(memberTypeNode) ||
		unionTypeNode.types.filter((member) => getKeyofTypeOperatorNode(member)).length !== 1
	) {
		return undefined;
	}

	const origin = (type as ts.Type & { origin?: ts.Type }).origin;
	if (!origin?.isUnion()) {
		return undefined;
	}
	const concreteMembers = origin.types.filter(
		(memberType) => !isUndefinedType(memberType) && isConcreteKeyofResultType(memberType),
	);
	return concreteMembers.length === 1 ? concreteMembers[0] : undefined;
}

function resolveAuthoredIntersection(
	typeNode: ts.IntersectionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): IntersectionNode {
	const memberTypeNodes = flattenIntersectionTypeNodes(typeNode) ?? typeNode.types;
	return new IntersectionNode(
		typeName,
		memberTypeNodes.map((memberTypeNode) => resolveAuthoredTypeNode(memberTypeNode, session)),
		[],
	);
}

function resolveCollapsedConditional(
	type: ts.Type,
	typeNode: ts.ConditionalTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType {
	const { checker } = session.context;
	if (isDistributiveConditionalInstantiation(typeNode, session)) {
		return type.isUnion()
			? new UnionNode(
					typeName,
					type.types.map((memberType) => session.resolve(memberType, undefined)),
				)
			: session.resolve(type, undefined);
	}

	const selectedBranch = getConcreteConditionalBranch(typeNode, session);
	if (selectedBranch) {
		return resolveAuthoredTypeNode(selectedBranch, session, type);
	}

	const trueType = getAuthoredTypeNodeType(typeNode.trueType, session);
	const falseType = getAuthoredTypeNodeType(typeNode.falseType, session);
	const trueMatches = typesAreEquivalent(type, trueType, checker);
	const falseMatches = typesAreEquivalent(type, falseType, checker);
	if (trueMatches && !falseMatches) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (falseMatches && !trueMatches) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(falseType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (isNeverType(trueType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(type)) {
		if (isNeverType(falseType)) {
			return resolveAuthoredTypeNode(typeNode.falseType, session, type);
		}
		if (isNeverType(trueType)) {
			return resolveAuthoredTypeNode(typeNode.trueType, session, type);
		}
	}

	return new UnionNode(typeName, [
		resolveAuthoredTypeNode(typeNode.trueType, session),
		resolveAuthoredTypeNode(typeNode.falseType, session),
	]);
}

function resolveAuthoredTypeNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
	typeOverride?: ts.Type,
): AnyType {
	const type = typeOverride ?? getAuthoredTypeNodeType(typeNode, session);
	return (
		resolveAuthoredKeyofAlias({ type, typeName: undefined, typeNode }, session) ??
		resolveTypeOperatorType({ type, typeName: undefined, typeNode }, session) ??
		session.resolve(type, typeNode)
	);
}

function getAuthoredTypeNodeType(typeNode: ts.TypeNode, session: TypeResolutionSession): ts.Type {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	return operatorNode
		? getKeyofResultTypeFromSyntax(operatorNode, session.context)
		: session.context.checker.getTypeFromTypeNode(typeNode);
}

function typesAreEquivalent(type1: ts.Type, type2: ts.Type, checker: ts.TypeChecker): boolean {
	if (type1.flags & ts.TypeFlags.Any || type2.flags & ts.TypeFlags.Any) {
		return Boolean(type1.flags & ts.TypeFlags.Any) && Boolean(type2.flags & ts.TypeFlags.Any);
	}
	return checker.isTypeAssignableTo(type1, type2) && checker.isTypeAssignableTo(type2, type1);
}

function isDistributiveConditionalInstantiation(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): boolean {
	const { checker, typeParameterSubstitutions } = session.context;
	if (!typeParameterSubstitutions?.size) {
		return false;
	}

	const checkType = checker.getTypeFromTypeNode(typeNode.checkType);
	if (!(checkType.flags & ts.TypeFlags.TypeParameter)) {
		return false;
	}

	return substituteTypeParameter(checkType, typeParameterSubstitutions).isUnion();
}

function getConcreteConditionalBranch(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): ts.TypeNode | undefined {
	const { checker, typeParameterSubstitutions } = session.context;
	const authoredCheckType = checker.getTypeFromTypeNode(typeNode.checkType);
	const authoredExtendsType = checker.getTypeFromTypeNode(typeNode.extendsType);
	if (
		typeParameterSubstitutions?.size &&
		((!(authoredCheckType.flags & ts.TypeFlags.TypeParameter) &&
			typeNodeReferencesSubstitutedParameter(
				typeNode.checkType,
				checker,
				typeParameterSubstitutions,
			)) ||
			(!(authoredExtendsType.flags & ts.TypeFlags.TypeParameter) &&
				typeNodeReferencesSubstitutedParameter(
					typeNode.extendsType,
					checker,
					typeParameterSubstitutions,
				)))
	) {
		return undefined;
	}
	const checkType = typeParameterSubstitutions
		? substituteTypeParameter(authoredCheckType, typeParameterSubstitutions)
		: authoredCheckType;
	const extendsType = typeParameterSubstitutions
		? substituteTypeParameter(authoredExtendsType, typeParameterSubstitutions)
		: authoredExtendsType;
	const unresolvedFlags =
		ts.TypeFlags.Any |
		ts.TypeFlags.Never |
		ts.TypeFlags.TypeParameter |
		ts.TypeFlags.Conditional |
		ts.TypeFlags.Substitution;
	if (checkType.flags & unresolvedFlags || extendsType.flags & unresolvedFlags) {
		return undefined;
	}

	return checker.isTypeAssignableTo(checkType, extendsType)
		? typeNode.trueType
		: typeNode.falseType;
}

function typeNodeReferencesSubstitutedParameter(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type>,
): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const symbol = checker.getSymbolAtLocation(node.typeName);
			if (symbol && substitutions.has(symbol)) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
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
		const typeId = getTypeId(type);
		if (typeId !== undefined && session.context.typeStack.includes(typeId)) {
			return compactTypeOperatorOperand(session.resolve(type, typeNode));
		}

		const request: TypeResolutionRequest = {
			type,
			typeNode,
			typeName: getFullName(type, typeNode, session.context),
		};
		const externalType = resolveExternalType(request, session);
		if (externalType) {
			return externalType;
		}

		if (typeId !== undefined) {
			session.context.typeStack.push(typeId);
		}
		try {
			const shallowObject = resolveShallowObjectLikeType(request, session);
			if (shallowObject) {
				return shallowObject;
			}
		} finally {
			if (typeId !== undefined) {
				session.context.typeStack.pop();
			}
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
		const resolvedMembers = memberTypes.map((memberType) =>
			resolveTypeOperatorResult(memberType, session),
		);

		return {
			type: new UnionNode(
				options.typeName,
				resolvedMembers.map((member) => member.type),
			),
			resolutionKind: aggregateResolutionKinds(
				resolvedMembers.map((member) => member.resolutionKind),
			),
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

	reportUnsupportedTypeFallback(type, undefined, session.context);
	return { type: new IntrinsicNode('any'), resolutionKind: 'fallback' };
}

function aggregateResolutionKinds(
	resolutionKinds: readonly TypeOperatorResolutionKind[],
): TypeOperatorResolutionKind {
	if (resolutionKinds.includes('fallback')) {
		return 'fallback';
	}
	if (resolutionKinds.includes('baseConstraint')) {
		return 'baseConstraint';
	}
	return 'exact';
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

function isNeverType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Never) !== 0;
}

function isConcreteKeyofResultType(type: ts.Type): boolean {
	if (type.isUnion()) {
		return type.types.every(
			(memberType) => isUndefinedType(memberType) || isConcreteKeyofResultType(memberType),
		);
	}

	return (
		(type.flags &
			(ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.ESSymbol |
				ts.TypeFlags.UniqueESSymbol |
				ts.TypeFlags.Literal |
				ts.TypeFlags.Never)) !==
		0
	);
}
