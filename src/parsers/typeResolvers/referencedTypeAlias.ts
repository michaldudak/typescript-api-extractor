import ts from 'typescript';

/**
 * Returns the type-alias declaration named by authored reference syntax.
 *
 * Both ordinary references (`Alias<T>`) and import types
 * (`import('./module').Alias<T>`) resolve through the same alias-symbol path so
 * container resolvers cannot drift in which reference forms they support.
 * Transparent parentheses are ignored; all other syntax returns `undefined`.
 *
 * @param typeNode - Authored syntax that may reference a type alias.
 * @param checker - Checker used to resolve and follow import aliases.
 * @returns The referenced type-alias declaration, when one exists.
 */
export function getReferencedTypeAliasDeclaration(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	let reference = typeNode;
	while (reference && ts.isParenthesizedTypeNode(reference)) {
		reference = reference.type;
	}

	const location = reference
		? ts.isTypeReferenceNode(reference)
			? reference.typeName
			: ts.isImportTypeNode(reference)
				? reference.qualifier
				: undefined
		: undefined;
	if (!location) {
		return undefined;
	}

	const symbol = checker.getSymbolAtLocation(location);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}
