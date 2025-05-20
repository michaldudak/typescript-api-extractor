import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';
import { IntrinsicNode, PropertyNode, TypeNode } from '../models';
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
		let parsedType: TypeNode;
		if ((type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) && propertySignature) {
			parsedType = new IntrinsicNode('any');
			isOptional = Boolean(propertySignature.questionToken);
		} else {
			parsedType = resolveType(type, context, propertySignature?.type, skipResolvingComplexTypes);
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
