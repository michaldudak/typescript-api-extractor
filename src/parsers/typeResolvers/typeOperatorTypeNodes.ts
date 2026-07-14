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
		const elementTypeNode = tupleTypeNode?.elements[indexType.value];
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
	const propertyTypeNode = getPropertyTypeNode(property);
	if (!propertyTypeNode) {
		return undefined;
	}

	return getIndexedAccessSourceTypeNode(propertyTypeNode, checker) ?? propertyTypeNode;
}

/** Locates the terminal authored source that actually contains an indexed-access `keyof`. */
export function getIndexedAccessKeyofSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const sourceTypeNode = getIndexedAccessSourceTypeNode(typeNode, checker);
	return sourceTypeNode ? followTypeAliasToKeyofSource(sourceTypeNode, checker) : undefined;
}

function getPropertyTypeNode(property: ts.Symbol | undefined): ts.TypeNode | undefined {
	for (const declaration of property?.declarations ?? []) {
		if (
			(ts.isPropertySignature(declaration) ||
				ts.isPropertyDeclaration(declaration) ||
				ts.isGetAccessorDeclaration(declaration)) &&
			declaration.type
		) {
			return declaration.type;
		}
	}

	for (const declaration of property?.declarations ?? []) {
		if (ts.isSetAccessorDeclaration(declaration)) {
			return declaration.parameters[0]?.type;
		}
	}

	return undefined;
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
