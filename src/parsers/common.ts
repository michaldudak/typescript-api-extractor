import ts from 'typescript';

export function getFullyQualifiedName(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
) {
	// The following code handles cases where the type is a simple alias of another type (type Alias = SomeType).
	// TypeScript resolves the alias automatically, but we want to preserve the original type symbol if it exists.
	//
	// However, this also covers cases where the type is a type parameter (as in `type Generic<T> = { value: T }`).
	// Here we don't want to preserve T as a type symbol, but rather resolve it to its actual type.
	let typeSymbol: ts.Symbol | undefined;
	if (typeNode && ts.isTypeReferenceNode(typeNode)) {
		const typeNodeName = (typeNode as ts.TypeReferenceNode).typeName;
		let typeSymbolCandidate: ts.Symbol | undefined;
		if (ts.isIdentifier(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
		} else if (ts.isQualifiedName(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
		}

		if (
			typeSymbolCandidate &&
			!areEquivalent(typeNodeName, type, checker) &&
			!(typeSymbolCandidate.flags & ts.SymbolFlags.TypeParameter)
		) {
			typeSymbol = typeSymbolCandidate;
		}
	}

	const name = getTypeName(type, typeSymbol, checker);
	const namespaces = typeSymbol ? getTypeSymbolNamespaces(typeSymbol) : getTypeNamespaces(type);

	return {
		name,
		namespaces,
	};
}

export function getTypeNamespaces(type: ts.Type): string[] {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return [];
	}

	return getTypeSymbolNamespaces(symbol);
}

function getTypeSymbolNamespaces(typeSymbol: ts.Symbol): string[] {
	if (typeSymbol.name === '__function' || typeSymbol.name === '__type') {
		return [];
	}

	const declaration = typeSymbol.valueDeclaration ?? typeSymbol.declarations?.[0];
	return getNodeNamespaces(declaration);
}
function getNodeNamespaces(node: ts.Node | undefined): string[] {
	if (!node) {
		return [];
	}

	const namespaces: string[] = [];
	let currentNode = node.parent;

	while (currentNode != null && !ts.isSourceFile(currentNode)) {
		if (ts.isModuleDeclaration(currentNode)) {
			namespaces.unshift(currentNode.name.getText());
		}

		currentNode = currentNode.parent;
	}

	return namespaces;
}

function getTypeName(
	type: ts.Type,
	typeSymbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return undefined;
	}

	if (typeSymbol && !type.aliasSymbol && !type.symbol && !isAnyOrUnknown(type)) {
		return undefined;
	}

	const typeName = symbol.getName();
	if (typeName === '__type') {
		return undefined;
	}

	let typeArguments: string[] | undefined;

	if (type.aliasSymbol && !type.aliasTypeArguments) {
		typeArguments = [];
	} else {
		if ('target' in type) {
			typeArguments = checker
				.getTypeArguments(type as ts.TypeReference)
				?.map((x) => getTypeName(x, undefined, checker) ?? checker.typeToString(x) ?? 'unknown');
		}

		if (!typeArguments?.length) {
			typeArguments =
				type.aliasTypeArguments?.map(
					(x) => getTypeName(x, undefined, checker) ?? checker.typeToString(x) ?? 'unknown',
				) ?? [];
		}
	}

	if (
		typeArguments &&
		typeArguments.length > 0 &&
		!areAllGenericArgumentsSameAsDefault(type, checker)
	) {
		return `${typeName}<${typeArguments.join(', ')}>`;
	}

	return typeName;
}

function areAllGenericArgumentsSameAsDefault(
	type: ts.Type, // The instantiated type, e.g., Props<string>
	checker: ts.TypeChecker,
): boolean {
	if (
		!(type.flags & ts.TypeFlags.Object) ||
		!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
	) {
		return false;
	}

	const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
	if (typeArguments.length === 0) {
		return true; // No arguments to compare
	}

	const targetType = (type as ts.TypeReference).target;
	const targetSymbol = targetType.getSymbol();
	if (!targetSymbol?.declarations || targetSymbol.declarations.length === 0) {
		return false;
	}

	const declaration = targetSymbol.declarations[0];

	if (
		!ts.isInterfaceDeclaration(declaration) &&
		!ts.isTypeAliasDeclaration(declaration) &&
		!ts.isClassDeclaration(declaration) &&
		!ts.isFunctionDeclaration(declaration)
	) {
		return false;
	}

	const typeParameters = declaration.typeParameters;
	if (!typeParameters || typeParameters.length < typeArguments.length) {
		return false;
	}

	for (let i = 0; i < typeArguments.length; i++) {
		const argumentType = typeArguments[i];
		const typeParameterDeclaration = typeParameters[i];

		if (!typeParameterDeclaration.default) {
			return false; // Argument provided for a parameter without a default
		}

		const defaultType = checker.getTypeFromTypeNode(typeParameterDeclaration.default);

		if (argumentType !== defaultType) {
			return false;
		}
	}

	return true;
}

function areEquivalent(
	typeNodeName: ts.EntityName,
	type: ts.Type,
	checker: ts.TypeChecker,
): boolean | undefined {
	if (ts.isIdentifier(typeNodeName)) {
		const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
		if (!typeSymbolCandidate) {
			return undefined;
		}

		return (
			typeNodeName.text === type.aliasSymbol?.name &&
			getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
		);
	} else if (ts.isQualifiedName(typeNodeName)) {
		const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
		if (!typeSymbolCandidate) {
			return undefined;
		}

		return (
			typeNodeName.right.text === type.aliasSymbol?.name &&
			getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
		);
	}

	return undefined;
}

function isAnyOrUnknown(type: ts.Type): boolean {
	return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) > 0;
}
