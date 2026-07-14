import ts from 'typescript';
import { ArrayNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import {
	containsKeyofTypeOperatorOrAlias,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

// Array handling is small but still owns a distinct TypeScript
// shape. Keeping it separate makes resolver precedence and element recursion
// easy to inspect from the registry.

export function resolveArrayType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker } = session.context;

	if (!checker.isArrayType(type)) {
		return undefined;
	}

	// @ts-expect-error - Private method
	const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
	return new ArrayNode(
		type.aliasSymbol?.name
			? new TypeName(type.aliasSymbol?.name, typeName?.namespaces, typeName?.typeArguments)
			: undefined,
		session.resolve(
			arrayType,
			getArrayElementTypeNode(
				typeNode,
				checker,
				session.context.typeParameterTypeNodeSubstitutions,
			),
		),
		isReadonlyArrayType(type, typeNode, checker) ? true : undefined,
	);
}

function isReadonlyArrayType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): boolean {
	const targetSymbol =
		type.flags & ts.TypeFlags.Object && 'target' in type
			? (type as ts.TypeReference).target.symbol
			: undefined;
	if (
		targetSymbol?.name === 'ReadonlyArray' &&
		targetSymbol.declarations?.some((declaration) =>
			/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
		)
	) {
		return true;
	}

	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword) {
		return true;
	}

	return (
		ts.isTypeReferenceNode(unwrapped) &&
		getBuiltInArrayReferenceName(unwrapped, checker) === 'ReadonlyArray'
	);
}

export function getArrayElementTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	let elementType: ts.TypeNode | undefined;
	if (ts.isArrayTypeNode(unwrapped)) {
		elementType = unwrapped.elementType;
	}
	if (ts.isTypeReferenceNode(unwrapped) && isBuiltInArrayReference(unwrapped, checker)) {
		elementType = unwrapped.typeArguments?.[0];
	}

	if (!elementType) {
		return undefined;
	}
	const substitutedElementType = substituteTypeParameterTypeNode(
		elementType,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	return containsKeyofTypeOperatorOrAlias(substitutedElementType, checker)
		? substitutedElementType
		: undefined;
}

function isBuiltInArrayReference(typeNode: ts.TypeReferenceNode, checker: ts.TypeChecker): boolean {
	return getBuiltInArrayReferenceName(typeNode, checker) !== undefined;
}

function getBuiltInArrayReferenceName(
	typeNode: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): 'Array' | 'ReadonlyArray' | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	if (
		!targetSymbol ||
		!['Array', 'ReadonlyArray'].includes(targetSymbol.getName()) ||
		!(targetSymbol.flags & ts.SymbolFlags.Interface)
	) {
		return undefined;
	}

	const isBuiltIn =
		targetSymbol.declarations?.some((declaration) =>
			/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
		) ?? false;
	return isBuiltIn ? (targetSymbol.getName() as 'Array' | 'ReadonlyArray') : undefined;
}
