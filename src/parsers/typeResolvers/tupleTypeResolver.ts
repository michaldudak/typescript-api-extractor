import ts from 'typescript';
import { TupleNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getArrayElementTypeNode } from './arrayTypeResolver';
import {
	containsKeyofTypeOperator,
	containsKeyofTypeOperatorOrAlias,
	containsKeyofTypeNodeSubstitution,
	getTupleElementTypeNodeAtSemanticIndex,
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

	const elementTypes = (type as ts.TupleType).typeArguments ?? [];
	return new TupleNode(
		typeName,
		elementTypes.map((elementType, index) =>
			session.resolve(
				elementType,
				getTupleElementTypeNode(
					typeNode,
					index,
					elementTypes.length,
					checker,
					session.context.typeParameterTypeNodeSubstitutions,
					session.context.includeExternalTypes,
				),
			),
		),
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
	semanticElementCount: number,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (!ts.isTupleTypeNode(unwrapped)) {
		return undefined;
	}

	const selection = getTupleElementSelection(
		unwrapped,
		index,
		semanticElementCount,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	let element = selection?.typeNode;
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
		const substitutedRestType = substituteTypeParameterTypeNode(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
		);
		const substitutedRestTuple = unwrapReadonlyContainerTypeNode(substitutedRestType);
		if (ts.isTupleTypeNode(substitutedRestTuple) && selection?.restSemanticIndex != null) {
			element = getTupleElementTypeNodeAtSemanticIndex(
				substitutedRestTuple,
				selection.restSemanticIndex,
				selection.restSemanticElementCount,
			);
			isRest = false;
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
		} else {
			element = substitutedRestType;
		}
		const restElementType = getArrayElementTypeNode(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
		);
		if (restElementType) {
			return restElementType;
		}
	}
	element = substituteTypeParameterTypeNode(element, checker, typeParameterTypeNodeSubstitutions);
	if (
		!containsKeyofTypeOperator(element) &&
		!containsKeyofTypeOperatorOrAlias(element, checker, new Set(), includeExternalTypes) &&
		!containsKeyofTypeNodeSubstitution(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
		)
	) {
		return undefined;
	}
	if (element && isRest) {
		return (
			getArrayElementTypeNode(
				element,
				checker,
				typeParameterTypeNodeSubstitutions,
				includeExternalTypes,
			) ?? element
		);
	}

	return element;
}

interface TupleElementSelection {
	typeNode: ts.TypeNode;
	restSemanticIndex?: number;
	restSemanticElementCount: number;
}

function getTupleElementSelection(
	tupleTypeNode: ts.TupleTypeNode,
	semanticIndex: number,
	semanticElementCount: number,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
): TupleElementSelection | undefined {
	const widths = tupleTypeNode.elements.map((element) =>
		getKnownTupleElementWidth(element, checker, typeParameterTypeNodeSubstitutions, new Set()),
	);
	if (
		widths.every((width): width is number => width != null) &&
		widths.reduce((total, width) => total + width, 0) === semanticElementCount
	) {
		let semanticOffset = 0;
		for (let authoredIndex = 0; authoredIndex < tupleTypeNode.elements.length; authoredIndex += 1) {
			const element = tupleTypeNode.elements[authoredIndex]!;
			const width = widths[authoredIndex]!;
			if (semanticIndex < semanticOffset + width) {
				return {
					typeNode: element,
					restSemanticIndex: isRestTupleElementNode(element)
						? semanticIndex - semanticOffset
						: undefined,
					restSemanticElementCount: width,
				};
			}
			semanticOffset += width;
		}
	}

	const typeNode = getTupleElementTypeNodeAtSemanticIndex(
		tupleTypeNode,
		semanticIndex,
		semanticElementCount,
	);
	if (!typeNode) {
		return undefined;
	}
	const authoredIndex = tupleTypeNode.elements.indexOf(typeNode);
	return {
		typeNode,
		restSemanticIndex: isRestTupleElementNode(typeNode) ? semanticIndex - authoredIndex : undefined,
		restSemanticElementCount: semanticElementCount - (tupleTypeNode.elements.length - 1),
	};
}

function getKnownTupleElementWidth(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeNode>,
): number | undefined {
	if (!isRestTupleElementNode(typeNode)) {
		return 1;
	}

	let restTypeNode = ts.isNamedTupleMember(typeNode) ? typeNode.type : typeNode;
	while (ts.isRestTypeNode(restTypeNode)) {
		restTypeNode = restTypeNode.type;
	}
	const substituted = substituteTypeParameterTypeNode(
		restTypeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const tuple = unwrapReadonlyContainerTypeNode(substituted);
	if (!ts.isTupleTypeNode(tuple) || seen.has(tuple)) {
		return undefined;
	}
	const nestedSeen = new Set(seen);
	nestedSeen.add(tuple);
	const widths = tuple.elements.map((element) =>
		getKnownTupleElementWidth(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
			new Set(nestedSeen),
		),
	);
	return widths.every((width): width is number => width != null)
		? widths.reduce((total, width) => total + width, 0)
		: undefined;
}

function isRestTupleElementNode(typeNode: ts.TypeNode): boolean {
	return ts.isNamedTupleMember(typeNode)
		? typeNode.dotDotDotToken != null
		: ts.isRestTypeNode(typeNode);
}
