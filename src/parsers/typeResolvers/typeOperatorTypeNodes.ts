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
	if (!indexType.isStringLiteral()) {
		return undefined;
	}

	const property = objectType.getProperty(indexType.value);
	const declaration = property?.declarations?.find(
		(candidate): candidate is ts.PropertySignature | ts.PropertyDeclaration =>
			ts.isPropertySignature(candidate) || ts.isPropertyDeclaration(candidate),
	);
	if (!declaration?.type) {
		return undefined;
	}

	return getIndexedAccessSourceTypeNode(declaration.type, checker) ?? declaration.type;
}
