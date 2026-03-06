import ts from 'typescript';
import { TypeArgument, TypeName } from '../models/typeName';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';

/**
 * Known TypeScript compiler-generated internal symbol names.
 * These are names the compiler assigns to anonymous or synthetic symbols
 * and should not appear in parsed output as real type names.
 *
 * See: TypeScript's `InternalSymbolName` enum in `src/compiler/types.ts`.
 */
const TS_INTERNAL_SYMBOL_NAMES = new Set([
	'__call',
	'__constructor',
	'__new',
	'__index',
	'__export',
	'__global',
	'__missing',
	'__type',
	'__object',
	'__jsxAttributes',
	'__class',
	'__function',
	'__computed',
	'__resolving__',
	'__instantiationExpression',
	'__importAttributes',
]);

/**
 * Returns true if the given name is a TypeScript compiler-internal symbol name
 * (e.g., `__type`, `__object`, `__function`). These are assigned to anonymous
 * or synthetic symbols and are not meaningful user-authored type names.
 *
 * This does NOT match arbitrary user-authored names that happen to start with `__`.
 */
export function isInternalSymbolName(name: string): boolean {
	return TS_INTERNAL_SYMBOL_NAMES.has(name);
}

/**
 * Extracts namespace parts from a qualified name node.
 * For example, `ComponentRoot.ChangeEventDetails` returns `['ComponentRoot']`.
 */
function getQualifiedNameNamespaces(typeNodeName: ts.EntityName): string[] {
	const namespaces: string[] = [];
	let current: ts.EntityName = typeNodeName;

	// Walk left through the qualified name, collecting namespace parts
	while (ts.isQualifiedName(current)) {
		// Move to the left side
		current = current.left;
		// If the left side is an identifier, it's a namespace
		if (ts.isIdentifier(current)) {
			namespaces.unshift(current.text);
		}
	}

	return namespaces;
}

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
	let qualifiedNameNamespaces: string[] = [];
	if (typeNode && ts.isTypeReferenceNode(typeNode)) {
		const typeNodeName = (typeNode as ts.TypeReferenceNode).typeName;
		let typeSymbolCandidate: ts.Symbol | undefined;
		if (ts.isIdentifier(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
		} else if (ts.isQualifiedName(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
			// Extract namespace parts from the qualified name itself
			// This handles cases like `ComponentRoot.ChangeEventDetails` where
			// `ComponentRoot` is used as a namespace qualifier in the type reference
			qualifiedNameNamespaces = getQualifiedNameNamespaces(typeNodeName);
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
	// Use namespaces from the symbol/type first, but fall back to qualified name namespaces
	// when the type doesn't have intrinsic namespace information
	let namespaces = typeSymbol ? getTypeSymbolNamespaces(typeSymbol) : getTypeNamespaces(type);
	if (namespaces.length === 0 && qualifiedNameNamespaces.length > 0) {
		namespaces = qualifiedNameNamespaces;
	}
	const typeArguments = getTypeArguments(type, typeNode, typeSymbol, context);

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
	// Skip TypeScript internal symbol names (e.g., __type, __object, __function)
	if (isInternalSymbolName(typeSymbol.name)) {
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

function typeSymbolIsNonGenericAlias(typeSymbol: ts.Symbol): boolean {
	const decl = typeSymbol.declarations?.[0];
	if (!decl) {
		return false;
	}
	if (ts.isTypeAliasDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
		return !decl.typeParameters || decl.typeParameters.length === 0;
	}
	return false;
}

function getTypeName(type: ts.Type, typeSymbol: ts.Symbol | undefined): string | undefined {
	const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return undefined;
	}

	// When TypeScript has lost both aliasSymbol and symbol on the resolved type
	// (e.g. due to `& {}` flattening), the typeSymbol from the authored typeNode
	// may still be valid — but only if it's a non-generic alias.
	// Generic aliases (like `ReasonToEvent<Reason>`) have stale typeNode references
	// after TypeScript instantiates the type parameters, so we must discard them.
	if (typeSymbol && !type.aliasSymbol && !type.getSymbol()) {
		if (!typeSymbolIsNonGenericAlias(typeSymbol)) {
			return undefined;
		}
	}

	const typeName = symbol.getName();

	// Filter out TypeScript internal symbol names (e.g., __type for anonymous type literals,
	// __object for anonymous object literals, __function for anonymous functions).
	// These are not meaningful type names and should not appear in the output.
	if (isInternalSymbolName(typeName)) {
		// If we have a typeSymbol from the typeNode, use its name instead
		if (typeSymbol && !isInternalSymbolName(typeSymbol.getName())) {
			return typeSymbol.getName();
		}
		return undefined;
	}

	return typeName;
}

function getTypeArguments(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	typeSymbol: ts.Symbol | undefined,
	context: ParserContext,
): TypeArgument[] {
	let typeArguments: TypeArgument[] = [];

	const nodeTypeArguments =
		typeNode && ts.isTypeReferenceNode(typeNode)
			? ((typeNode as ts.TypeReferenceNode).typeArguments ?? [])
			: [];

	// When the type name comes from the typeNode symbol (e.g., `TabsLikeDetails` from the authored
	// source) rather than from TypeScript's resolved type, the aliasSymbol/aliasTypeArguments may
	// belong to a _different_ type (the inner generic the alias wraps). In this case, we should only
	// use type arguments that actually appear on the authored typeNode reference.
	if (typeSymbol && type.aliasSymbol && typeSymbol !== type.aliasSymbol) {
		// The typeNode reference determines the type arguments — if the authored code writes
		// `TabsLikeDetails` (no angle brackets), there are no type arguments.
		typeArguments = nodeTypeArguments.map((argNode, index) => {
			const argType = context.checker.getTypeFromTypeNode(argNode);
			const parameterType = resolveType(argType, argNode, context);
			const equalToDefault = isGenericArgumentsSameAsDefault(type, index, context.checker);
			return { type: parameterType, equalToDefault } satisfies TypeArgument;
		});
		return typeArguments;
	}

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
