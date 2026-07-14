import ts from 'typescript';
import { TupleNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { containsKeyofTypeOperator, unwrapParenthesizedTypeNode } from './typeOperatorTypeNodes';

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
			session.resolve(elementType, getTupleElementTypeNode(typeNode, index)),
		) ?? [],
	);
}

function getTupleElementTypeNode(
	typeNode: ts.TypeNode | undefined,
	index: number,
): ts.TypeNode | undefined {
	if (!containsKeyofTypeOperator(typeNode) || !typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isTupleTypeNode(unwrapped)) {
		return undefined;
	}

	let element = unwrapped.elements[index];
	if (element && ts.isNamedTupleMember(element)) {
		element = element.type;
	}
	while (element && (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element))) {
		element = element.type;
	}

	return element;
}
