import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';
import { IntrinsicNode, PropertyNode, TypeNode } from '../models';

export function parseProperty(
	propertySymbol: ts.Symbol,
	propertySignature: ts.PropertySignature | undefined,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): PropertyNode {
	const { checker } = context;

	let type: ts.Type;
	if (propertySignature) {
		if (!propertySignature.type) {
			type = checker.getAnyType();
		} else {
			type = checker.getTypeOfSymbolAtLocation(propertySymbol, propertySignature.type);
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
		parsedType = resolveType(type, propertySymbol.getName(), context, skipResolvingComplexTypes);
		isOptional = Boolean(propertySymbol.flags & ts.SymbolFlags.Optional);
	}

	return new PropertyNode(
		propertySymbol.getName(),
		parsedType,
		getDocumentationFromSymbol(propertySymbol, checker),
		isOptional,
		(propertySymbol as any).id,
	);
}
