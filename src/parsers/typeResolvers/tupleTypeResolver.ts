import ts from 'typescript';
import { TupleNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getArrayElementTypeNode } from './arrayTypeResolver';
import {
	containsKeyofTypeOperatorOrAlias,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

// Tuple handling stays separate from arrays because TypeScript
// exposes tuple element types through tuple-specific metadata and the output
// model preserves tuple arity.

export function resolveTupleType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker } = session.context;

	if (!checker.isTupleType(type)) {
		return undefined;
	}

	return new TupleNode(
		typeName,
		(type as ts.TupleType).typeArguments?.map((elementType, index) =>
			session.resolve(
				elementType,
				getTupleElementTypeNode(
					typeNode,
					index,
					checker,
					session.context.typeParameterTypeNodeSubstitutions,
				),
			),
		) ?? [],
		isReadonlyTupleType(type, typeNode) ? true : undefined,
	);
}

function isReadonlyTupleType(type: ts.Type, typeNode: ts.TypeNode | undefined): boolean {
	if ('target' in type && (type as ts.TupleTypeReference).target.readonly) {
		return true;
	}
	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return (
		ts.isTypeOperatorNode(unwrapped) &&
		unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isTupleTypeNode(unwrapParenthesizedTypeNode(unwrapped.type))
	);
}

function getTupleElementTypeNode(
	typeNode: ts.TypeNode | undefined,
	index: number,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (!ts.isTupleTypeNode(unwrapped)) {
		return undefined;
	}

	let element = unwrapped.elements[index];
	let isRest = false;
	if (element && ts.isNamedTupleMember(element)) {
		isRest = element.dotDotDotToken != null;
		element = element.type;
	}
	while (element && (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element))) {
		isRest ||= ts.isRestTypeNode(element);
		element = element.type;
	}
	if (!element) {
		return undefined;
	}
	if (isRest) {
		const restElementType = getArrayElementTypeNode(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
		);
		if (restElementType) {
			return restElementType;
		}
	}
	element = substituteTypeParameterTypeNode(element, checker, typeParameterTypeNodeSubstitutions);
	if (!containsKeyofTypeOperatorOrAlias(element, checker)) {
		return undefined;
	}
	if (element && isRest) {
		return getArrayElementTypeNode(element, checker, typeParameterTypeNodeSubstitutions) ?? element;
	}

	return element;
}
