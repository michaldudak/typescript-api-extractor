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

/**
 * Returns the interface or class declaration named by authored reference syntax.
 *
 * Nominal declarations carry their own type parameters, so generic binding and
 * `keyof` replay have to agree on which declaration a reference points at.
 * Unlike the alias lookup above this does not unwrap parentheses, because its
 * callers pass syntax that has already been unwrapped.
 *
 * @param typeNode - Authored syntax that may reference an interface or class.
 * @param checker - Checker used to resolve and follow import aliases.
 * @returns The referenced interface or class declaration, when one exists.
 */
export function getReferencedInterfaceOrClassDeclaration(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.InterfaceDeclaration | ts.ClassDeclaration | undefined {
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
	return targetSymbol?.declarations?.find(
		(declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration =>
			ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration),
	);
}
