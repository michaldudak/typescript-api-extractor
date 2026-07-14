import ts from 'typescript';
import { ArrayNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { containsKeyofTypeOperator, unwrapParenthesizedTypeNode } from './typeOperatorTypeNodes';

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
		session.resolve(arrayType, getArrayElementTypeNode(typeNode, checker)),
	);
}

function getArrayElementTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	if (!containsKeyofTypeOperator(typeNode) || !typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isArrayTypeNode(unwrapped)) {
		return unwrapped.elementType;
	}
	if (ts.isTypeReferenceNode(unwrapped) && isBuiltInArrayReference(unwrapped, checker)) {
		return unwrapped.typeArguments?.[0];
	}

	return undefined;
}

function isBuiltInArrayReference(typeNode: ts.TypeReferenceNode, checker: ts.TypeChecker): boolean {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	if (
		!targetSymbol ||
		!['Array', 'ReadonlyArray'].includes(targetSymbol.getName()) ||
		!(targetSymbol.flags & ts.SymbolFlags.Interface)
	) {
		return false;
	}

	return (
		targetSymbol.declarations?.some((declaration) =>
			/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
		) ?? false
	);
}
