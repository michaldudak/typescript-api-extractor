import ts from 'typescript';
import { isRestTupleElementNode, unwrapTupleElementSyntax } from '../typeContainerUtils';
import { areSemanticTypesEquivalent } from '../typeResolutionUtils';
import {
	declarationHasNodeModulesPathSegment,
	hasNodeModulesPathSegment,
} from '../sourceFileUtils';
import { deriveTypeParameterBindings } from '../typeParameterBindings';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';

/**
 * Removes parenthesized wrappers that are transparent to type-operator resolution.
 *
 * @param typeNode - Authored syntax to unwrap.
 * @returns The first non-parenthesized type node.
 */
export function unwrapParenthesizedTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
	let unwrapped = typeNode;
	while (ts.isParenthesizedTypeNode(unwrapped)) {
		unwrapped = unwrapped.type;
	}

	return unwrapped;
}

/**
 * Removes parentheses, readonly operators, and TypeScript's built-in
 * `Readonly<T>` utility while locating an array or tuple container. The
 * checker-backed utility test prevents a user-defined alias with the same name
 * from being treated as transparent.
 *
 * @param typeNode - Authored container syntax to unwrap.
 * @param checker - Optional checker used to identify the built-in `Readonly` alias.
 * @param substitutions - Active authored generic substitutions applied after each wrapper.
 * @returns The underlying non-readonly container node.
 */
export function unwrapReadonlyContainerTypeNode(
	typeNode: ts.TypeNode,
	checker?: ts.TypeChecker,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode {
	let unwrapped = unwrapParenthesizedTypeNode(typeNode);
	while (true) {
		if (checker) {
			const substituted = substituteTypeParameterTypeNode(unwrapped, checker, substitutions);
			if (substituted !== unwrapped) {
				unwrapped = unwrapParenthesizedTypeNode(substituted);
				continue;
			}
		}
		if (ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword) {
			unwrapped = unwrapParenthesizedTypeNode(unwrapped.type);
			continue;
		}
		if (checker && isBuiltInReadonlyUtilityReference(unwrapped, checker)) {
			unwrapped = unwrapParenthesizedTypeNode(unwrapped.typeArguments![0]!);
			continue;
		}
		break;
	}

	return unwrapped;
}

function isBuiltInReadonlyUtilityReference(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): typeNode is ts.TypeReferenceNode & { typeArguments: ts.NodeArray<ts.TypeNode> } {
	if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length !== 1) {
		return false;
	}

	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return (
		targetSymbol?.name === 'Readonly' &&
		Boolean(targetSymbol.declarations?.some(isBuiltInReadonlyUtilityDeclaration))
	);
}

/**
 * Identifies TypeScript's built-in `Readonly<T>` alias declaration. A name
 * check alone is insufficient because projects may shadow `Readonly` locally.
 *
 * @param declaration - Declaration proposed as the built-in utility alias.
 * @returns Whether the declaration is `Readonly` from a TypeScript lib file.
 */
export function isBuiltInReadonlyUtilityDeclaration(
	declaration: ts.Declaration,
): declaration is ts.TypeAliasDeclaration {
	return (
		ts.isTypeAliasDeclaration(declaration) &&
		declaration.name.text === 'Readonly' &&
		/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName)
	);
}

/**
 * Locates a root authored `keyof` node after removing transparent parentheses.
 *
 * @param typeNode - Optional authored syntax to inspect.
 * @returns The root `keyof` node, or `undefined` for any other shape.
 */
export function getKeyofTypeOperatorNode(
	typeNode: ts.TypeNode | undefined,
): ts.TypeOperatorNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.KeyOfKeyword
		? unwrapped
		: undefined;
}

/**
 * Checks whether a syntax subtree contains an authored `keyof` expression.
 *
 * @param typeNode - Optional syntax subtree to traverse.
 * @returns Whether any descendant is a `keyof` operator.
 */
export function containsKeyofTypeOperator(typeNode: ts.TypeNode | undefined): boolean {
	if (!typeNode) {
		return false;
	}

	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}

		if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
			found = true;
			return;
		}

		ts.forEachChild(node, visit);
	};
	visit(typeNode);

	return found;
}

/**
 * Replaces a root type-parameter reference with its active authored argument.
 *
 * Only bare root references are substituted. Rewriting arbitrary descendants
 * here would manufacture syntax the caller did not author and would overlap
 * the dedicated nested-substitution probe. The seen-symbol set also protects
 * malformed or mutually recursive substitution maps.
 *
 * @param typeNode - Authored root syntax that may name a type parameter.
 * @param checker - Checker used to resolve the referenced parameter symbol.
 * @param substitutions - Active mapping from parameter symbols to authored arguments.
 * @returns The terminal substituted root node, or the original node when no binding applies.
 */
export function substituteTypeParameterTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): ts.TypeNode {
	let substituted = typeNode;
	const seen = new Set<ts.Symbol>();
	while (substitutions) {
		const unwrapped = unwrapParenthesizedTypeNode(substituted);
		if (!ts.isTypeReferenceNode(unwrapped) || unwrapped.typeArguments?.length) {
			break;
		}
		const symbol = checker.getSymbolAtLocation(unwrapped.typeName);
		if (!symbol || seen.has(symbol)) {
			break;
		}
		const replacement = substitutions.get(symbol);
		if (!replacement) {
			break;
		}
		seen.add(symbol);
		substituted = replacement;
	}

	return substituted;
}

/**
 * Checks whether a syntax subtree receives `keyof` through an active authored argument.
 *
 * @param typeNode - Optional syntax subtree containing type references.
 * @param checker - Checker used to resolve type-parameter symbols and alias declarations.
 * @param substitutions - Active authored type-parameter arguments.
 * @param includeExternalTypes - Whether alias traversal may enter external declarations.
 * @returns Whether substituting any referenced parameter exposes preservable `keyof` syntax.
 */
export function containsKeyofTypeNodeSubstitution(
	typeNode: ts.Node | undefined,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes = false,
): boolean {
	if (!typeNode || !substitutions?.size) {
		return false;
	}

	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const substituted = substituteTypeParameterTypeNode(node, checker, substitutions);
			if (
				substituted !== node &&
				containsKeyofTypeOperatorOrAlias(substituted, checker, new Set(), includeExternalTypes)
			) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
}

/**
 * Applies root substitutions and keeps only syntax capable of replaying `keyof`.
 *
 * @param typeNode - Optional authored syntax proposed for nested resolution.
 * @param checker - Checker used for parameter and alias lookups.
 * @param substitutions - Active authored generic substitutions.
 * @param includeExternalTypes - Whether alias traversal may enter external declarations.
 * @returns Preservable substituted syntax, or `undefined` when semantic resolution is sufficient.
 */
export function getPreservableKeyofTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	return containsKeyofTypeOperator(substituted) ||
		containsKeyofTypeOperatorOrAlias(substituted, checker, new Set(), includeExternalTypes) ||
		containsKeyofTypeNodeSubstitution(substituted, checker, substitutions, includeExternalTypes)
		? substituted
		: undefined;
}

/**
 * Checks authored syntax and supported alias/container chains for a `keyof` expression.
 *
 * Traversal is deliberately limited to transparent containers whose output can
 * faithfully replay a nested operator. The alias set prevents recursive alias
 * graphs, and external traversal follows the caller's public expansion policy.
 *
 * @param typeNode - Optional authored syntax or alias reference to inspect.
 * @param checker - Checker used to follow local, imported, and qualified aliases.
 * @param seenAliases - Alias declarations already visited by the current traversal.
 * @param includeExternalTypes - Whether traversal may enter external aliases.
 * @param substitutions - Active authored arguments for generic alias parameters.
 * @param seenAliasInstantiations - Generic alias bindings already visited on this path.
 * @returns Whether replayable `keyof` syntax is reachable.
 */
export function containsKeyofTypeOperatorOrAlias(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>> = new Map(),
): boolean {
	if (!typeNode) {
		return false;
	}

	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted, checker, substitutions);
	if (getKeyofTypeOperatorNode(unwrapped)) {
		return true;
	}
	if (ts.isArrayTypeNode(unwrapped)) {
		return containsKeyofTypeOperatorOrAlias(
			unwrapped.elementType,
			checker,
			seenAliases,
			includeExternalTypes,
			substitutions,
			seenAliasInstantiations,
		);
	}
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped.elements.some((element) =>
			containsKeyofTypeOperatorOrAlias(
				unwrapTupleElementSyntax(element).typeNode,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
			),
		);
	}
	if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
		return unwrapped.types.some((member) =>
			containsKeyofTypeOperatorOrAlias(
				member,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
			),
		);
	}
	if (ts.isConditionalTypeNode(unwrapped)) {
		return (
			containsKeyofTypeOperatorOrAlias(
				unwrapped.trueType,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
			) ||
			containsKeyofTypeOperatorOrAlias(
				unwrapped.falseType,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
			)
		);
	}
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		return Boolean(
			getIndexedAccessKeyofSourceTypeNode(unwrapped, checker, includeExternalTypes, substitutions),
		);
	}
	if (ts.isImportTypeNode(unwrapped)) {
		const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
		const aliasSubstitutions = declaration
			? getAliasTypeNodeSubstitutions(declaration, unwrapped.typeArguments, checker, substitutions)
			: undefined;
		const instantiationKey = declaration
			? getAliasInstantiationKey(declaration, aliasSubstitutions, checker)
			: undefined;
		if (
			!declaration ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration)) ||
			hasSeenAliasInstantiation(declaration, instantiationKey, seenAliases, seenAliasInstantiations)
		) {
			return false;
		}
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(declaration);
		const nextSeenAliasInstantiations = addSeenAliasInstantiation(
			declaration,
			instantiationKey,
			seenAliasInstantiations,
		);
		return containsKeyofTypeOperatorOrAlias(
			declaration.type,
			checker,
			nextSeenAliases,
			includeExternalTypes,
			aliasSubstitutions,
			nextSeenAliasInstantiations,
		);
	}
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return false;
	}

	const referenceName = ts.isIdentifier(unwrapped.typeName) ? unwrapped.typeName.text : undefined;
	if (referenceName === 'Array' || referenceName === 'ReadonlyArray') {
		return (
			unwrapped.typeArguments?.some((argument) =>
				containsKeyofTypeOperatorOrAlias(
					argument,
					checker,
					seenAliases,
					includeExternalTypes,
					substitutions,
					seenAliasInstantiations,
				),
			) ?? false
		);
	}

	const declaration =
		getReferencedTypeAliasDeclaration(unwrapped, checker) ??
		findLocalTypeAliasDeclaration(unwrapped);
	const aliasSubstitutions = declaration
		? getAliasTypeNodeSubstitutions(declaration, unwrapped.typeArguments, checker, substitutions)
		: undefined;
	const instantiationKey = declaration
		? getAliasInstantiationKey(declaration, aliasSubstitutions, checker)
		: undefined;
	if (
		!declaration ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration)) ||
		hasSeenAliasInstantiation(declaration, instantiationKey, seenAliases, seenAliasInstantiations)
	) {
		return false;
	}
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	const nextSeenAliasInstantiations = addSeenAliasInstantiation(
		declaration,
		instantiationKey,
		seenAliasInstantiations,
	);
	return containsKeyofTypeOperatorOrAlias(
		declaration.type,
		checker,
		nextSeenAliases,
		includeExternalTypes,
		aliasSubstitutions,
		nextSeenAliasInstantiations,
	);
}

function hasSeenAliasInstantiation(
	declaration: ts.TypeAliasDeclaration,
	instantiationKey: string | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>>,
): boolean {
	return instantiationKey
		? Boolean(seenAliasInstantiations.get(declaration)?.has(instantiationKey))
		: seenAliases.has(declaration);
}

function addSeenAliasInstantiation(
	declaration: ts.TypeAliasDeclaration,
	instantiationKey: string | undefined,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>>,
): Map<ts.TypeAliasDeclaration, Set<string>> {
	if (!instantiationKey) {
		return seenAliasInstantiations;
	}
	const next = new Map(seenAliasInstantiations);
	const declarationInstantiations = new Set(next.get(declaration));
	declarationInstantiations.add(instantiationKey);
	next.set(declaration, declarationInstantiations);
	return next;
}

function getAliasInstantiationKey(
	declaration: ts.TypeAliasDeclaration,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	if (!declaration.typeParameters?.length) {
		return undefined;
	}
	return declaration.typeParameters
		.map((parameter) => {
			const symbol = checker.getSymbolAtLocation(parameter.name);
			const typeNode = symbol ? substitutions?.get(symbol) : undefined;
			return typeNode
				? `${typeNode.getSourceFile().fileName}:${typeNode.pos}:${typeNode.end}`
				: '<unbound>';
		})
		.join('|');
}

/**
 * Extends authored substitutions while descending through a generic alias.
 * Binding the declaration body, rather than merely scanning type arguments,
 * avoids treating an unused `keyof` argument as replayable syntax.
 */
function getAliasTypeNodeSubstitutions(
	declaration: ts.TypeAliasDeclaration,
	typeArguments: readonly ts.TypeNode[] | undefined,
	checker: ts.TypeChecker,
	baseTypeNodes: Map<ts.Symbol, ts.TypeNode> | undefined,
): Map<ts.Symbol, ts.TypeNode> | undefined {
	return deriveTypeParameterBindings({
		checker,
		declarations: declaration.typeParameters,
		authoredArguments: typeArguments,
		baseTypeNodes,
		useDeclarationDefaults: true,
		bodyForFreshSymbols: declaration.type,
	})?.typeNodes;
}

/**
 * Flattens authored intersection syntax while preserving source order.
 *
 * @param typeNode - Authored syntax that may be a nested intersection.
 * @returns Flat intersection members, or `undefined` when the root is not an intersection.
 */
export function flattenIntersectionTypeNodes(
	typeNode: ts.TypeNode,
): readonly ts.TypeNode[] | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isIntersectionTypeNode(unwrapped)) {
		return undefined;
	}

	return unwrapped.types.flatMap((member) => {
		const nestedMembers = flattenIntersectionTypeNodes(member);
		return nestedMembers ?? [unwrapParenthesizedTypeNode(member)];
	});
}

/**
 * Follows a literal indexed access to the selected property's authored type node.
 *
 * Numeric tuple access must map TypeScript's expanded semantic index back to
 * authored rest/suffix positions. String access follows the selected property,
 * and both forms recurse through nested indexed accesses until reaching the
 * terminal syntax that should control source-preserving resolution.
 *
 * @param typeNode - Authored indexed-access syntax to follow.
 * @param checker - Checker used to resolve the object, index, and property symbols.
 * @param includeExternalTypes - Whether selected syntax may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns The terminal selected type node, or `undefined` when the access is not statically known.
 */
export function getIndexedAccessSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapParenthesizedTypeNode(substituted);
	if (!ts.isIndexedAccessTypeNode(unwrapped)) {
		return undefined;
	}

	const objectType = checker.getTypeFromTypeNode(unwrapped.objectType);
	const indexType = checker.getTypeFromTypeNode(unwrapped.indexType);
	if (indexType.isNumberLiteral()) {
		const tupleTypeNode = getTupleSourceTypeNode(
			unwrapped.objectType,
			checker,
			includeExternalTypes,
			substitutions,
		);
		const tupleElementCount = checker.isTupleType(objectType)
			? ((objectType as ts.TupleType).typeArguments?.length ?? tupleTypeNode?.elements.length ?? 0)
			: (tupleTypeNode?.elements.length ?? 0);
		const tupleSelection = tupleTypeNode
			? getTupleElementSelectionAtSemanticIndex(tupleTypeNode, indexType.value, tupleElementCount)
			: undefined;
		const elementTypeNode = tupleSelection
			? getTupleIndexedElementSourceTypeNode(
					tupleSelection,
					checker,
					includeExternalTypes,
					substitutions,
				)
			: !tupleTypeNode
				? getArrayIndexedElementTypeNode(
						unwrapped.objectType,
						checker,
						includeExternalTypes,
						substitutions,
					)
				: undefined;
		if (!elementTypeNode) {
			return undefined;
		}

		return (
			getIndexedAccessSourceTypeNode(
				elementTypeNode,
				checker,
				includeExternalTypes,
				substitutions,
			) ?? elementTypeNode
		);
	}
	if (indexType.flags & ts.TypeFlags.Number) {
		const tupleElementTypeNodes = getTupleNumberIndexedTypeNodes(
			unwrapped.objectType,
			checker,
			includeExternalTypes,
			substitutions,
		);
		const elementTypeNode =
			tupleElementTypeNodes?.length === 1
				? tupleElementTypeNodes[0]
				: getArrayIndexedElementTypeNode(
						unwrapped.objectType,
						checker,
						includeExternalTypes,
						substitutions,
					);
		if (!elementTypeNode) {
			return undefined;
		}
		return (
			getIndexedAccessSourceTypeNode(
				elementTypeNode,
				checker,
				includeExternalTypes,
				substitutions,
			) ?? elementTypeNode
		);
	}

	if (!indexType.isStringLiteral()) {
		return undefined;
	}
	const property = objectType.getProperty(indexType.value);
	const propertyTypeNode = getPropertyTypeNode(property, checker);
	if (
		!propertyTypeNode ||
		(!includeExternalTypes && hasNodeModulesPathSegment(propertyTypeNode.getSourceFile()))
	) {
		return undefined;
	}

	return (
		getIndexedAccessSourceTypeNode(
			propertyTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		) ?? propertyTypeNode
	);
}

/**
 * Checks whether a root type or one of its explicit union members is an indexed access.
 * These are the syntax shapes the union resolver can use to reconstruct authored
 * member order without treating unrelated nested indexed accesses as root sources.
 *
 * @param typeNode - Authored type syntax to inspect.
 * @returns Whether the root or an explicit union member is an indexed access.
 */
export function containsIndexedAccessUnionSource(typeNode: ts.TypeNode | undefined): boolean {
	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return (
		ts.isIndexedAccessTypeNode(unwrapped) ||
		(ts.isUnionTypeNode(unwrapped) &&
			unwrapped.types.some((member) => containsIndexedAccessUnionSource(member)))
	);
}

/**
 * Returns the fixed authored tuple members selected by a `number` index.
 * Optional and rest members are excluded because their undefined/element
 * semantics cannot be reconstructed by resolving the wrapper node directly.
 *
 * @param typeNode - Authored tuple syntax or alias reference.
 * @param checker - Checker used to follow aliases and substitutions.
 * @param includeExternalTypes - Whether tuple aliases may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns Fixed tuple member nodes, or `undefined` for non-fixed/non-tuple inputs.
 */
export function getTupleNumberIndexedTypeNodes(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): readonly ts.TypeNode[] | undefined {
	const tupleTypeNode = getTupleSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	if (
		!tupleTypeNode ||
		tupleTypeNode.elements.some(
			(element) =>
				isRestTupleElementNode(element) ||
				ts.isOptionalTypeNode(element) ||
				(ts.isNamedTupleMember(element) && element.questionToken != null),
		)
	) {
		return undefined;
	}
	return tupleTypeNode.elements.map((element) => unwrapTupleElementSyntax(element).typeNode);
}

/**
 * Follows array and readonly-array aliases to their authored element syntax.
 * Generic bindings are extended at each alias so `List<keyof T>[number]`
 * reaches the concrete operator argument instead of the reduced key union.
 */
function getArrayIndexedElementTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted, checker, substitutions);
	if (ts.isArrayTypeNode(unwrapped)) {
		return substituteTypeParameterTypeNode(unwrapped.elementType, checker, substitutions);
	}
	if (isBuiltInArrayTypeReference(unwrapped, checker)) {
		const elementTypeNode = unwrapped.typeArguments?.[0];
		return elementTypeNode
			? substituteTypeParameterTypeNode(elementTypeNode, checker, substitutions)
			: undefined;
	}

	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seenAliases.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	const typeArguments =
		ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const aliasSubstitutions = getAliasTypeNodeSubstitutions(
		declaration,
		typeArguments,
		checker,
		substitutions,
	);
	return getArrayIndexedElementTypeNode(
		declaration.type,
		checker,
		includeExternalTypes,
		aliasSubstitutions,
		nextSeenAliases,
	);
}

/**
 * Checks whether a reference resolves to TypeScript's global array interfaces.
 * Projects may shadow `Array` and `ReadonlyArray`, so textual names alone are
 * insufficient when replaying authored indexed-access syntax.
 *
 * @param typeNode - Candidate array reference.
 * @param checker - Checker used to resolve the referenced symbol.
 * @returns Whether the reference is a built-in array with one element argument.
 */
function isBuiltInArrayTypeReference(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): typeNode is ts.TypeReferenceNode & { typeArguments: ts.NodeArray<ts.TypeNode> } {
	if (
		!ts.isTypeReferenceNode(typeNode) ||
		!ts.isIdentifier(typeNode.typeName) ||
		typeNode.typeArguments?.length !== 1 ||
		(typeNode.typeName.text !== 'Array' && typeNode.typeName.text !== 'ReadonlyArray')
	) {
		return false;
	}

	const referenceName = typeNode.typeName.text;
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return Boolean(
		targetSymbol?.declarations?.some(
			(declaration) =>
				ts.isInterfaceDeclaration(declaration) &&
				declaration.name.text === referenceName &&
				/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
		),
	);
}

/**
 * Maps an expanded semantic tuple index back to its authored tuple element.
 *
 * For `[Head, ...Middle, Tail]`, semantic elements between `Head` and the final
 * suffix all map to the rest node, while the suffix is aligned from the end.
 *
 * @param tupleTypeNode - Authored tuple syntax containing fixed and optional rest elements.
 * @param index - Zero-based index in TypeScript's expanded semantic tuple.
 * @param semanticElementCount - Total number of expanded semantic elements.
 * @returns The authored element responsible for the semantic index.
 */
export function getTupleElementTypeNodeAtSemanticIndex(
	tupleTypeNode: ts.TupleTypeNode,
	index: number,
	semanticElementCount: number,
): ts.TypeNode | undefined {
	return getTupleElementSelectionAtSemanticIndex(tupleTypeNode, index, semanticElementCount)
		?.typeNode;
}

interface TupleElementSelection {
	typeNode: ts.TypeNode;
	restSemanticIndex?: number;
	restSemanticElementCount?: number;
}

// Rest selections retain their local checker index. A finite tuple spread uses
// it to select the corresponding nested tuple member, while an open array rest
// uses the same metadata for any literal index beyond the checker's placeholder.
function getTupleElementSelectionAtSemanticIndex(
	tupleTypeNode: ts.TupleTypeNode,
	index: number,
	semanticElementCount: number,
): TupleElementSelection | undefined {
	const restIndex = tupleTypeNode.elements.findIndex(isRestTupleElementNode);
	if (restIndex === -1) {
		const typeNode = tupleTypeNode.elements[index];
		return typeNode ? { typeNode } : undefined;
	}
	if (index < restIndex) {
		const typeNode = tupleTypeNode.elements[index];
		return typeNode ? { typeNode } : undefined;
	}

	const suffixLength = tupleTypeNode.elements.length - restIndex - 1;
	const semanticSuffixStart = semanticElementCount - suffixLength;
	if (index >= semanticSuffixStart && index < semanticElementCount) {
		const typeNode = tupleTypeNode.elements[restIndex + 1 + index - semanticSuffixStart];
		return typeNode ? { typeNode } : undefined;
	}

	const typeNode = tupleTypeNode.elements[restIndex];
	const restSemanticIndex = index - restIndex;
	return {
		typeNode,
		restSemanticIndex,
		restSemanticElementCount: Math.max(semanticSuffixStart - restIndex, restSemanticIndex + 1),
	};
}

// Resolve rest selections recursively instead of replaying the authored spread
// container. Alias bindings travel with finite tuple sources; open array rests
// terminate at their element syntax.
function getTupleIndexedElementSourceTypeNode(
	selection: TupleElementSelection,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenTupleSources: Set<ts.TupleTypeNode> = new Set(),
): ts.TypeNode | undefined {
	const elementSyntax = unwrapTupleElementSyntax(selection.typeNode);
	const elementTypeNode = substituteTypeParameterTypeNode(
		elementSyntax.typeNode,
		checker,
		substitutions,
	);
	if (!elementSyntax.isRest) {
		return elementTypeNode;
	}

	const arrayElementTypeNode = getArrayIndexedElementTypeNode(
		elementTypeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	if (arrayElementTypeNode) {
		return arrayElementTypeNode;
	}
	if (selection.restSemanticIndex == null || selection.restSemanticElementCount == null) {
		return undefined;
	}

	const tupleSource = getBoundTupleSourceTypeNode(
		elementTypeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	if (!tupleSource || seenTupleSources.has(tupleSource.typeNode)) {
		return undefined;
	}
	const nestedSelection = getTupleElementSelectionAtSemanticIndex(
		tupleSource.typeNode,
		selection.restSemanticIndex,
		selection.restSemanticElementCount,
	);
	if (!nestedSelection) {
		return undefined;
	}

	const nextSeenTupleSources = new Set(seenTupleSources);
	nextSeenTupleSources.add(tupleSource.typeNode);
	return getTupleIndexedElementSourceTypeNode(
		nestedSelection,
		checker,
		includeExternalTypes,
		tupleSource.substitutions,
		nextSeenTupleSources,
	);
}

/**
 * Locates the terminal authored source that contains an indexed-access `keyof`.
 *
 * @param typeNode - Indexed-access syntax whose selected property should be traced.
 * @param checker - Checker used for property and alias resolution.
 * @param includeExternalTypes - Whether tracing may enter external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns The terminal syntax containing `keyof`, or `undefined` when none is reachable.
 */
export function getIndexedAccessKeyofSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode | undefined {
	const sourceTypeNode = getIndexedAccessSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	return sourceTypeNode
		? followTypeAliasToKeyofSource(sourceTypeNode, checker, includeExternalTypes, substitutions)
		: undefined;
}

/**
 * Selects one unambiguous authored type node for a readable property symbol.
 *
 * Getter annotations take precedence because they define the readable side of
 * an accessor pair. Otherwise every readable declaration must have identical
 * text and an equivalent semantic type; disagreeing merged declarations return
 * `undefined` so source syntax cannot incorrectly override checker semantics.
 * Setter parameters are considered only when no readable declaration exists.
 *
 * @param property - Property symbol whose declarations should be examined.
 * @param checker - Checker used to verify semantic equivalence across declarations.
 * @returns A stable authored property type node, or `undefined` when none is unambiguous.
 */
export function getPropertyTypeNode(
	property: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const declarations = property?.declarations ?? [];
	const getterTypeNode = declarations.find(
		(declaration): declaration is ts.GetAccessorDeclaration =>
			ts.isGetAccessorDeclaration(declaration) && declaration.type != null,
	)?.type;
	if (getterTypeNode) {
		return getterTypeNode;
	}

	const readableCandidates: ts.TypeNode[] = [];
	for (const declaration of declarations) {
		if (
			(ts.isPropertySignature(declaration) ||
				ts.isPropertyDeclaration(declaration) ||
				ts.isParameter(declaration)) &&
			declaration.type
		) {
			readableCandidates.push(declaration.type);
		}
	}

	const setterCandidates: ts.TypeNode[] = [];
	for (const declaration of declarations) {
		if (ts.isSetAccessorDeclaration(declaration)) {
			const parameterType = declaration.parameters[0]?.type;
			if (parameterType) {
				setterCandidates.push(parameterType);
			}
		}
	}

	const candidates = readableCandidates.length > 0 ? readableCandidates : setterCandidates;
	const first = candidates[0];
	if (!first) {
		return undefined;
	}
	const firstType = checker.getTypeFromTypeNode(first);
	return candidates.every((candidate) => {
		if (candidate.getText() !== first.getText()) {
			return false;
		}
		const candidateType = checker.getTypeFromTypeNode(candidate);
		return (
			candidateType === firstType || areSemanticTypesEquivalent(candidateType, firstType, checker)
		);
	})
		? first
		: undefined;
}

function getTupleSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TupleTypeNode | undefined {
	return getBoundTupleSourceTypeNode(typeNode, checker, includeExternalTypes, substitutions, seen)
		?.typeNode;
}

interface BoundTupleSourceTypeNode {
	typeNode: ts.TupleTypeNode;
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined;
}

// Tuple-spread aliases need their authored generic bindings when a local rest
// index is resolved. Returning the bindings with the tuple source prevents a
// nested alias body from being interpreted in its uninstantiated declaration.
function getBoundTupleSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): BoundTupleSourceTypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted, checker, substitutions);
	if (ts.isTupleTypeNode(unwrapped)) {
		return { typeNode: unwrapped, substitutions };
	}
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seen.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	const nextSeen = new Set(seen);
	nextSeen.add(declaration);
	const typeArguments =
		ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const aliasSubstitutions = getAliasTypeNodeSubstitutions(
		declaration,
		typeArguments,
		checker,
		substitutions,
	);
	return getBoundTupleSourceTypeNode(
		declaration.type,
		checker,
		includeExternalTypes,
		aliasSubstitutions,
		nextSeen,
	);
}

function followTypeAliasToKeyofSource(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	if (!includeExternalTypes && hasNodeModulesPathSegment(substituted.getSourceFile())) {
		return undefined;
	}
	const preservableTypeNode = getPreservableKeyofTypeNode(
		substituted,
		checker,
		substitutions,
		includeExternalTypes,
	);
	if (preservableTypeNode) {
		return preservableTypeNode;
	}

	const unwrapped = unwrapParenthesizedTypeNode(substituted);
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seen.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	seen.add(declaration);
	return followTypeAliasToKeyofSource(
		declaration.type,
		checker,
		includeExternalTypes,
		substitutions,
		seen,
	);
}

function findLocalTypeAliasDeclaration(
	typeNode: ts.TypeReferenceNode,
): ts.TypeAliasDeclaration | undefined {
	if (!ts.isIdentifier(typeNode.typeName)) {
		return undefined;
	}
	const referencedName = typeNode.typeName.text;
	return typeNode
		.getSourceFile()
		.statements.find(
			(statement): statement is ts.TypeAliasDeclaration =>
				ts.isTypeAliasDeclaration(statement) && statement.name.text === referencedName,
		);
}

/**
 * Checks whether a type reference is bound by a relative project import.
 *
 * @param typeNode - Authored type reference whose root binding should be inspected.
 * @returns Whether a default, namespace, or named import from a relative module binds the root.
 */
export function isRelativeImportedTypeReference(typeNode: ts.TypeReferenceNode): boolean {
	let rootName = typeNode.typeName;
	while (ts.isQualifiedName(rootName)) {
		rootName = rootName.left;
	}
	if (!ts.isIdentifier(rootName)) {
		return false;
	}

	for (const statement of typeNode.getSourceFile().statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!statement.moduleSpecifier.text.startsWith('.') ||
			!statement.importClause
		) {
			continue;
		}
		const { importClause } = statement;
		if (importClause.name?.text === rootName.text) {
			return true;
		}
		const bindings = importClause.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === rootName.text) {
			return true;
		}
		if (
			bindings &&
			ts.isNamedImports(bindings) &&
			bindings.elements.some((element) => element.name.text === rootName.text)
		) {
			return true;
		}
	}
	return false;
}
