import ts from 'typescript';
import { TypeArgument, TypeName } from '../models/typeName';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';

export function getFullName(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): TypeName | undefined {
	const { checker } = context;

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

	const name = getTypeName(type, typeSymbol);
	const namespaces = typeSymbol ? getTypeSymbolNamespaces(typeSymbol) : getTypeNamespaces(type);
	const typeArguments = getTypeArguments(type, typeNode, context);

	if (name === undefined) {
		return undefined;
	}

	return new TypeName(
		name,
		namespaces.length > 0 ? namespaces : undefined,
		typeArguments.length > 0 ? typeArguments : undefined,
	);
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
	if (!declaration) {
		return [];
	}

	const namespaces: string[] = [];
	let currentNode = declaration.parent;

	while (currentNode != null && !ts.isSourceFile(currentNode)) {
		if (ts.isModuleDeclaration(currentNode)) {
			namespaces.unshift(currentNode.name.getText());
		}

		currentNode = currentNode.parent;
	}

	return namespaces;
}

function getTypeName(type: ts.Type, typeSymbol: ts.Symbol | undefined): string | undefined {
	const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return undefined;
	}

	// If we have a typeSymbol (extracted from the typeNode), we should use it
	// even if the resolved type is any/unknown, as long as it's not a built-in symbol
	if (typeSymbol && !type.aliasSymbol && !type.symbol && !isAnyOrUnknown(type)) {
		return undefined;
	}

	const typeName = symbol.getName();
	if (typeName === '__type') {
		return undefined;
	}

	return typeName;
}

function getTypeArguments(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): TypeArgument[] {
	let typeArguments: TypeArgument[] = [];

	const nodeTypeArguments =
		typeNode && ts.isTypeReferenceNode(typeNode)
			? ((typeNode as ts.TypeReferenceNode).typeArguments ?? [])
			: [];

	if (type.aliasSymbol && !type.aliasTypeArguments) {
		typeArguments = [];
	} else {
		if ('target' in type) {
			typeArguments = context.checker
				.getTypeArguments(type as ts.TypeReference)
				?.map((arg, index) => {
					const parameterType = resolveType(arg, nodeTypeArguments[index], context);
					const equalToDefault = isGenericArgumentsSameAsDefault(type, index, context.checker);

					return {
						type: parameterType,
						equalToDefault,
					} satisfies TypeArgument;
				});
		}

		if (!typeArguments.length) {
			typeArguments =
				type.aliasTypeArguments?.map((arg, index) => {
					const parameterType = resolveType(arg, nodeTypeArguments[index], context);
					resolveType(arg, undefined, context);
					const equalToDefault = isGenericArgumentsSameAsDefault(type, index, context.checker);

					return {
						type: parameterType,
						equalToDefault,
					} satisfies TypeArgument;
				}) ?? [];
		}
	}

	return typeArguments;
}

function isGenericArgumentsSameAsDefault(
	type: ts.Type, // The instantiated type, e.g., Props<string>
	argumentIndex: number,
	checker: ts.TypeChecker,
): boolean {
	let typeArguments: readonly ts.Type[] | undefined;
	let targetSymbol: ts.Symbol | undefined;

	if (
		type.flags & ts.TypeFlags.Object &&
		(type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
	) {
		typeArguments = checker.getTypeArguments(type as ts.TypeReference);
		const targetType = (type as ts.TypeReference).target;
		targetSymbol = targetType.getSymbol();
	} else {
		typeArguments = type.aliasTypeArguments;
		targetSymbol = type.aliasSymbol;
	}

	if (!typeArguments || typeArguments.length === 0) {
		return true; // No arguments to compare
	}

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

	const argumentType = typeArguments[argumentIndex];
	const typeParameterDeclaration = typeParameters[argumentIndex];

	if (!typeParameterDeclaration.default) {
		return false; // Argument provided for a parameter without a default
	}

	const defaultType = checker.getTypeFromTypeNode(typeParameterDeclaration.default);

	if (argumentType !== defaultType) {
		return false;
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
