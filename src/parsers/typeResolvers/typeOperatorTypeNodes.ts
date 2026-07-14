import ts from 'typescript';

/** Unwraps syntax that is transparent to type-operator resolution. */
export function unwrapParenthesizedTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
	let unwrapped = typeNode;
	while (ts.isParenthesizedTypeNode(unwrapped)) {
		unwrapped = unwrapped.type;
	}

	return unwrapped;
}

/** Unwraps syntax that is transparent when locating an array or tuple container. */
export function unwrapReadonlyContainerTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
	let unwrapped = unwrapParenthesizedTypeNode(typeNode);
	while (ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword) {
		unwrapped = unwrapParenthesizedTypeNode(unwrapped.type);
	}

	return unwrapped;
}

/** Returns an authored `keyof` node after removing transparent parentheses. */
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

/** Checks whether a type syntax subtree contains an authored `keyof` expression. */
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

/** Replaces a root type-parameter reference with its active authored argument. */
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

/** Checks whether an authored subtree receives `keyof` through an active type argument. */
export function containsKeyofTypeNodeSubstitution(
	typeNode: ts.TypeNode | undefined,
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

/** Checks authored syntax and any referenced type aliases for a `keyof` expression. */
export function containsKeyofTypeOperatorOrAlias(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
): boolean {
	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (getKeyofTypeOperatorNode(unwrapped)) {
		return true;
	}
	if (ts.isArrayTypeNode(unwrapped)) {
		return containsKeyofTypeOperatorOrAlias(
			unwrapped.elementType,
			checker,
			seenAliases,
			includeExternalTypes,
		);
	}
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped.elements.some((element) =>
			containsKeyofTypeOperatorOrAlias(
				unwrapTupleElementTypeNode(element),
				checker,
				seenAliases,
				includeExternalTypes,
			),
		);
	}
	if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
		return unwrapped.types.some((member) =>
			containsKeyofTypeOperatorOrAlias(member, checker, seenAliases, includeExternalTypes),
		);
	}
	if (ts.isConditionalTypeNode(unwrapped)) {
		return (
			containsKeyofTypeOperatorOrAlias(
				unwrapped.trueType,
				checker,
				seenAliases,
				includeExternalTypes,
			) ||
			containsKeyofTypeOperatorOrAlias(
				unwrapped.falseType,
				checker,
				seenAliases,
				includeExternalTypes,
			)
		);
	}
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		return Boolean(getIndexedAccessKeyofSourceTypeNode(unwrapped, checker));
	}
	if (ts.isImportTypeNode(unwrapped)) {
		const declaration = getImportTypeAliasDeclaration(unwrapped, checker);
		if (
			!declaration ||
			(!includeExternalTypes && isExternalTypeAliasDeclaration(declaration)) ||
			seenAliases.has(declaration)
		) {
			return false;
		}
		seenAliases.add(declaration);
		return containsKeyofTypeOperatorOrAlias(
			declaration.type,
			checker,
			seenAliases,
			includeExternalTypes,
		);
	}
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return false;
	}

	const referenceName = ts.isIdentifier(unwrapped.typeName) ? unwrapped.typeName.text : undefined;
	if (referenceName === 'Array' || referenceName === 'ReadonlyArray') {
		return (
			unwrapped.typeArguments?.some((argument) =>
				containsKeyofTypeOperatorOrAlias(argument, checker, seenAliases, includeExternalTypes),
			) ?? false
		);
	}

	const declaration =
		getTypeAliasDeclaration(unwrapped, checker) ?? findLocalTypeAliasDeclaration(unwrapped);
	if (
		!declaration ||
		(!includeExternalTypes && isExternalTypeAliasDeclaration(declaration)) ||
		seenAliases.has(declaration)
	) {
		return false;
	}
	seenAliases.add(declaration);
	return containsKeyofTypeOperatorOrAlias(
		declaration.type,
		checker,
		seenAliases,
		includeExternalTypes,
	);
}

/** Flattens authored intersection syntax while preserving source order. */
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

/** Follows a string-literal indexed access to the property's authored type node. */
export function getIndexedAccessSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isIndexedAccessTypeNode(unwrapped)) {
		return undefined;
	}

	const objectType = checker.getTypeFromTypeNode(unwrapped.objectType);
	const indexType = checker.getTypeFromTypeNode(unwrapped.indexType);
	if (indexType.isNumberLiteral()) {
		const tupleTypeNode = getTupleSourceTypeNode(unwrapped.objectType, checker);
		const tupleElementCount = checker.isTupleType(objectType)
			? ((objectType as ts.TupleType).typeArguments?.length ?? tupleTypeNode?.elements.length ?? 0)
			: (tupleTypeNode?.elements.length ?? 0);
		const elementTypeNode = tupleTypeNode
			? getTupleElementTypeNodeAtSemanticIndex(tupleTypeNode, indexType.value, tupleElementCount)
			: undefined;
		if (!elementTypeNode) {
			return undefined;
		}

		const elementType = unwrapTupleElementTypeNode(elementTypeNode);
		return getIndexedAccessSourceTypeNode(elementType, checker) ?? elementType;
	}

	if (!indexType.isStringLiteral()) {
		return undefined;
	}
	const property = objectType.getProperty(indexType.value);
	const propertyTypeNode = getPropertyTypeNode(property, checker);
	if (!propertyTypeNode) {
		return undefined;
	}

	return getIndexedAccessSourceTypeNode(propertyTypeNode, checker) ?? propertyTypeNode;
}

/** Maps an expanded semantic tuple index back to its authored tuple element. */
export function getTupleElementTypeNodeAtSemanticIndex(
	tupleTypeNode: ts.TupleTypeNode,
	index: number,
	semanticElementCount: number,
): ts.TypeNode | undefined {
	const restIndex = tupleTypeNode.elements.findIndex(isRestTupleElementNode);
	if (restIndex === -1) {
		return tupleTypeNode.elements[index];
	}
	if (index < restIndex) {
		return tupleTypeNode.elements[index];
	}

	const suffixLength = tupleTypeNode.elements.length - restIndex - 1;
	const semanticSuffixStart = semanticElementCount - suffixLength;
	if (index >= semanticSuffixStart) {
		return tupleTypeNode.elements[restIndex + 1 + index - semanticSuffixStart];
	}

	return tupleTypeNode.elements[restIndex];
}

function isRestTupleElementNode(typeNode: ts.TypeNode): boolean {
	return ts.isNamedTupleMember(typeNode)
		? typeNode.dotDotDotToken != null
		: ts.isRestTypeNode(typeNode);
}

/** Locates the terminal authored source that actually contains an indexed-access `keyof`. */
export function getIndexedAccessKeyofSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const sourceTypeNode = getIndexedAccessSourceTypeNode(typeNode, checker);
	return sourceTypeNode ? followTypeAliasToKeyofSource(sourceTypeNode, checker) : undefined;
}

export function getPropertyTypeNode(
	property: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const candidates: ts.TypeNode[] = [];
	for (const declaration of property?.declarations ?? []) {
		if (
			(ts.isPropertySignature(declaration) ||
				ts.isPropertyDeclaration(declaration) ||
				ts.isParameter(declaration) ||
				ts.isGetAccessorDeclaration(declaration)) &&
			declaration.type
		) {
			candidates.push(declaration.type);
		}
	}

	for (const declaration of property?.declarations ?? []) {
		if (ts.isSetAccessorDeclaration(declaration)) {
			const parameterType = declaration.parameters[0]?.type;
			if (parameterType) {
				candidates.push(parameterType);
			}
		}
	}

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
			candidateType === firstType ||
			(checker.isTypeAssignableTo(candidateType, firstType) &&
				checker.isTypeAssignableTo(firstType, candidateType))
		);
	})
		? first
		: undefined;
}

function getTupleSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TupleTypeNode | undefined {
	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped;
	}
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return undefined;
	}

	const declaration = getTypeAliasDeclaration(unwrapped, checker);
	if (!declaration || seen.has(declaration)) {
		return undefined;
	}
	seen.add(declaration);
	return getTupleSourceTypeNode(declaration.type, checker, seen);
}

function unwrapTupleElementTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
	let unwrapped = ts.isNamedTupleMember(typeNode) ? typeNode.type : typeNode;
	while (ts.isOptionalTypeNode(unwrapped) || ts.isRestTypeNode(unwrapped)) {
		unwrapped = unwrapped.type;
	}
	return unwrapped;
}

function followTypeAliasToKeyofSource(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TypeNode | undefined {
	if (containsKeyofTypeOperator(typeNode)) {
		return typeNode;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return undefined;
	}
	const declaration = getTypeAliasDeclaration(unwrapped, checker);
	if (!declaration || seen.has(declaration)) {
		return undefined;
	}
	seen.add(declaration);
	return followTypeAliasToKeyofSource(declaration.type, checker, seen);
}

function getTypeAliasDeclaration(
	typeNode: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}

function getImportTypeAliasDeclaration(
	typeNode: ts.ImportTypeNode,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	if (!typeNode.qualifier) {
		return undefined;
	}
	const symbol = checker.getSymbolAtLocation(typeNode.qualifier);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}

function isExternalTypeAliasDeclaration(declaration: ts.TypeAliasDeclaration): boolean {
	return /[\\/]node_modules[\\/]/.test(declaration.getSourceFile().fileName);
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
