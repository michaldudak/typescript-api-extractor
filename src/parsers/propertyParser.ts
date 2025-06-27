import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';
import { PropertyNode } from '../models';
import { ParserError } from '../ParserError';

export function parseProperty(
	propertySymbol: ts.Symbol,
	propertySignature: ts.PropertySignature | undefined,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): PropertyNode {
	const { checker, parsedSymbolStack } = context;
	parsedSymbolStack.push(`property: ${propertySymbol.name}`);

	try {
		let type: ts.Type;

		if (propertySignature) {
			if (propertySignature.type) {
				type = checker.getTypeOfSymbolAtLocation(propertySymbol, propertySignature.type);
			} else {
				type = checker.getAnyType();
			}
		} else {
			type = checker.getTypeOfSymbol(propertySymbol);
		}

		let isOptional = false;

		// Typechecker only gives the type "any" if it's present in a union
		// This means the type of "a" in {a?:any} isn't "any | undefined"
		// So instead we check for the questionmark to detect optional types
		const parsedType = resolveType(
			type,
			context,
			isTypeParameterLike(type) ? undefined : propertySignature?.type,
			skipResolvingComplexTypes,
		);
		if ((type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) && propertySignature) {
			isOptional = Boolean(propertySignature.questionToken);
		} else {
			isOptional = Boolean(propertySymbol.flags & ts.SymbolFlags.Optional);
		}

		return new PropertyNode(
			propertySymbol.getName(),
			parsedType,
			getDocumentationFromSymbol(propertySymbol, checker),
			isOptional,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(propertySymbol as any).id,
		);
	} catch (error) {
		if (!(error instanceof ParserError)) {
			throw new ParserError(error, parsedSymbolStack);
		} else {
			throw error;
		}
	} finally {
		parsedSymbolStack.pop();
	}
}

function isTypeParameterLike(type: ts.Type): boolean {
	// Check if the type is a type parameter
	return (
		(type.flags & ts.TypeFlags.TypeParameter) !== 0 ||
		((type.flags & ts.TypeFlags.Union) !== 0 && isOptionalTypeParameter(type as ts.UnionType))
	);
}

function isOptionalTypeParameter(type: ts.UnionType): boolean {
	// Check if the type is defined as
	// foo?: T
	// where T is a type parameter

	return (
		type.types.length === 2 &&
		type.types.some((t) => t.flags & ts.TypeFlags.Undefined) &&
		type.types.some(
			(t) => 'objectFlags' in t && ((t.objectFlags as number) & ts.ObjectFlags.Instantiated) !== 0,
		)
	);
}
