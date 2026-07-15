import ts from 'typescript';
import { TupleNode, type AnyType } from '../../models';
import {
	isRestTupleElementNode,
	isSemanticallyReadonlyTuple,
	unwrapTupleElementSyntax,
} from '../typeContainerUtils';
import { declarationHasNodeModulesPathSegment } from '../sourceFileUtils';
import { deriveTypeParameterBindings } from '../typeParameterBindings';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getArrayElementTypeNode } from './arrayTypeResolver';
import {
	getPreservableKeyofTypeNode,
	getTupleElementTypeNodeAtSemanticIndex,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Resolves tuples while mapping expanded semantic elements back to authored tuple syntax.
 *
 * @param request - Semantic tuple candidate, public name, and optional authored syntax.
 * @param session - Active resolution session used for element substitutions.
 * @returns A tuple model when the checker recognizes the type as a tuple, otherwise `undefined`.
 */
export function resolveTupleType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	const { checker } = session.context;

	if (!checker.isTupleType(type)) {
		return undefined;
	}

	const elementTypes = (type as ts.TupleType).typeArguments ?? [];
	const syntaxPlan = buildTupleElementSelectionPlan(
		typeNode,
		elementTypes.length,
		checker,
		session.context.typeParameterSubstitutions,
		session.context.typeParameterTypeNodeSubstitutions,
		session.context.includeExternalTypes,
	);
	return new TupleNode(
		typeName,
		elementTypes.map((elementType, index) => {
			const syntax = resolveTupleElementSyntax(
				syntaxPlan?.[index],
				checker,
				session.context.typeParameterSubstitutions,
				session.context.typeParameterTypeNodeSubstitutions,
				session.context.includeExternalTypes,
			);
			const resolveElement = () => session.resolve(elementType, syntax?.typeNode);
			return syntax?.typeParameterSubstitutions
				? session.context.runWithTypeParameterSubstitutionScope(
						syntax.typeParameterSubstitutions,
						resolveElement,
						syntax.typeParameterTypeNodeSubstitutions,
					)
				: resolveElement();
		}),
		isReadonlyTupleType(type, typeNode) ? true : undefined,
	);
}

function isReadonlyTupleType(type: ts.Type, typeNode: ts.TypeNode | undefined): boolean {
	if (isSemanticallyReadonlyTuple(type)) {
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

function resolveTupleElementSyntax(
	selection: TupleElementSelection | undefined,
	checker: ts.TypeChecker,
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): TupleElementSyntax | undefined {
	let element = selection?.typeNode;
	let isRest = false;
	if (element) {
		const syntax = unwrapTupleElementSyntax(element);
		element = syntax.typeNode;
		isRest = syntax.isRest;
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
		const tupleSource = getTupleTypeNodeSource(
			substitutedRestType,
			checker,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
		);
		if (tupleSource && selection?.restSemanticIndex != null) {
			typeParameterSubstitutions = tupleSource.typeParameterSubstitutions;
			typeParameterTypeNodeSubstitutions = tupleSource.typeParameterTypeNodeSubstitutions;
			element = getTupleElementTypeNodeAtSemanticIndex(
				tupleSource.typeNode,
				selection.restSemanticIndex,
				selection.restSemanticElementCount,
			);
			isRest = false;
			if (element) {
				const syntax = unwrapTupleElementSyntax(element);
				element = syntax.typeNode;
				isRest = syntax.isRest;
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
			return {
				typeNode: restElementType,
				typeParameterSubstitutions,
				typeParameterTypeNodeSubstitutions,
			};
		}
	}
	element = getPreservableKeyofTypeNode(
		element,
		checker,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
	);
	if (!element) {
		return undefined;
	}
	if (element && isRest) {
		const restTypeNode =
			getArrayElementTypeNode(
				element,
				checker,
				typeParameterTypeNodeSubstitutions,
				includeExternalTypes,
			) ?? element;
		return {
			typeNode: restTypeNode,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
		};
	}

	return {
		typeNode: element,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
	};
}

interface TupleElementSyntax {
	typeNode: ts.TypeNode;
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>;
}

interface TupleElementSelection {
	typeNode: ts.TypeNode;
	restSemanticIndex?: number;
	restSemanticElementCount: number;
}

/**
 * Builds the complete authored-to-semantic tuple selection plan once. When
 * every spread has a statically known tuple width, exact offsets are expanded
 * into one selection per checker element. Otherwise fixed prefixes and suffixes
 * are aligned around the first open rest element.
 *
 * Keeping width and rest-alias discovery outside the element-resolution loop is
 * important for long finite variadic tuples: following a 2,000-element rest
 * alias once is linear, while recomputing its width for every semantic element
 * is quadratic.
 */
function buildTupleElementSelectionPlan(
	typeNode: ts.TypeNode | undefined,
	semanticElementCount: number,
	checker: ts.TypeChecker,
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): (TupleElementSelection | undefined)[] | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (!ts.isTupleTypeNode(unwrapped)) {
		return undefined;
	}
	const tupleTypeNode = unwrapped;
	const widths = tupleTypeNode.elements.map((element) =>
		getKnownTupleElementWidth(
			element,
			checker,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
			new Set(),
		),
	);
	if (
		widths.every((width): width is number => width != null) &&
		widths.reduce((total, width) => total + width, 0) === semanticElementCount
	) {
		const selections: TupleElementSelection[] = [];
		for (let authoredIndex = 0; authoredIndex < tupleTypeNode.elements.length; authoredIndex += 1) {
			const element = tupleTypeNode.elements[authoredIndex]!;
			const width = widths[authoredIndex]!;
			for (let restSemanticIndex = 0; restSemanticIndex < width; restSemanticIndex += 1) {
				selections.push({
					typeNode: element,
					restSemanticIndex: isRestTupleElementNode(element) ? restSemanticIndex : undefined,
					restSemanticElementCount: width,
				});
			}
		}
		return selections;
	}

	const restIndex = tupleTypeNode.elements.findIndex(isRestTupleElementNode);
	const suffixLength = restIndex === -1 ? 0 : tupleTypeNode.elements.length - restIndex - 1;
	const semanticSuffixStart = semanticElementCount - suffixLength;
	const restSemanticElementCount = semanticElementCount - (tupleTypeNode.elements.length - 1);
	return Array.from({ length: semanticElementCount }, (_, semanticIndex) => {
		let authoredIndex = semanticIndex;
		if (restIndex !== -1 && semanticIndex >= restIndex) {
			authoredIndex =
				semanticIndex >= semanticSuffixStart
					? restIndex + 1 + semanticIndex - semanticSuffixStart
					: restIndex;
		}
		const selectedTypeNode = tupleTypeNode.elements[authoredIndex];
		if (!selectedTypeNode) {
			return undefined;
		}

		return {
			typeNode: selectedTypeNode,
			restSemanticIndex: isRestTupleElementNode(selectedTypeNode)
				? semanticIndex - restIndex
				: undefined,
			restSemanticElementCount,
		};
	});
}

/**
 * Computes the semantic width of an authored tuple element. Fixed elements are
 * one slot; rest elements have a known width only when their substituted type
 * can be followed to a finite tuple. The syntax-node set prevents recursive
 * tuple aliases from being treated as finite.
 */
function getKnownTupleElementWidth(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	seen: Set<ts.TypeNode>,
): number | undefined {
	if (!isRestTupleElementNode(typeNode)) {
		return 1;
	}

	const restTypeNode = unwrapTupleElementSyntax(typeNode).typeNode;
	const substituted = substituteTypeParameterTypeNode(
		restTypeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const tupleSource = getTupleTypeNodeSource(
		substituted,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
	);
	if (!tupleSource || seen.has(tupleSource.typeNode)) {
		return undefined;
	}
	const nestedSeen = new Set(seen);
	nestedSeen.add(tupleSource.typeNode);
	const widths = tupleSource.typeNode.elements.map((element) =>
		getKnownTupleElementWidth(
			element,
			checker,
			tupleSource.typeParameterSubstitutions,
			tupleSource.typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
			new Set(nestedSeen),
		),
	);
	return widths.every((width): width is number => width != null)
		? widths.reduce((total, width) => total + width, 0)
		: undefined;
}

interface TupleTypeNodeSource {
	typeNode: ts.TupleTypeNode;
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>;
}

/**
 * Follows a tuple alias chain while carrying both semantic and authored generic
 * bindings. Defaults and earlier bindings are applied before descending so a
 * nested rest alias is interpreted in the same instantiation as the checker
 * tuple whose elements are being mapped.
 */
function getTupleTypeNodeSource(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
): TupleTypeNodeSource | undefined {
	const substituted = substituteTypeParameterTypeNode(
		typeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted);
	if (ts.isTupleTypeNode(unwrapped)) {
		return {
			typeNode: unwrapped,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
		};
	}
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seenAliases.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}

	const nextAliases = new Set(seenAliases);
	nextAliases.add(declaration);
	const typeArguments = ts.isTypeReferenceNode(unwrapped)
		? unwrapped.typeArguments
		: ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const bindings = deriveTypeParameterBindings({
		checker,
		declarations: declaration.typeParameters,
		authoredArguments: typeArguments,
		baseTypes: typeParameterSubstitutions,
		baseTypeNodes: typeParameterTypeNodeSubstitutions,
		useDeclarationDefaults: true,
		substituteArgumentTypes: true,
	});

	return getTupleTypeNodeSource(
		declaration.type,
		checker,
		bindings?.types ?? new Map(typeParameterSubstitutions),
		bindings?.typeNodes ?? new Map(typeParameterTypeNodeSubstitutions),
		includeExternalTypes,
		nextAliases,
	);
}

function getReferencedTypeAliasDeclaration(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	const location = ts.isTypeReferenceNode(typeNode)
		? typeNode.typeName
		: ts.isImportTypeNode(typeNode)
			? typeNode.qualifier
			: undefined;
	if (!location) {
		return undefined;
	}
	const symbol = checker.getSymbolAtLocation(location);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}
