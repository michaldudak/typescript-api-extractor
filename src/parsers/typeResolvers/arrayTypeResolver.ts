import ts from 'typescript';
import { ArrayNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';

// Array handling is small but still owns a distinct TypeScript
// shape. Keeping it separate makes resolver precedence and element recursion
// easy to inspect from the registry.

export function resolveArrayType(
	{ type, typeName }: TypeResolutionRequest,
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
		session.resolve(arrayType, undefined),
	);
}
