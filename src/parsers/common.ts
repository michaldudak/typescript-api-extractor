import ts from 'typescript';

export function getTypeName(
	type: ts.Type,
	typeSymbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
	useFallback: boolean = true,
): string | undefined {
	const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	if (typeSymbol && !type.aliasSymbol && !type.symbol) {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	const typeName = symbol.getName();
	if (typeName === '__type') {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	let typeArguments: string[] | undefined;

	if (type.aliasSymbol && !type.aliasTypeArguments) {
		typeArguments = [];
	} else {
		if ('target' in type) {
			typeArguments = checker
				.getTypeArguments(type as ts.TypeReference)
				?.map((x) => getTypeName(x, undefined, checker, true) ?? 'unknown');
		}

		if (!typeArguments?.length) {
			typeArguments =
				type.aliasTypeArguments?.map(
					(x) => getTypeName(x, undefined, checker, true) ?? 'unknown',
				) ?? [];
		}
	}

	if (typeArguments && typeArguments.length > 0) {
		return `${typeName}<${typeArguments.join(', ')}>`;
	}

	return typeName;
}
