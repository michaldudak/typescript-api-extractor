import ts from 'typescript';
import * as t from '../types';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';

export function parseMember(
	propertySymbol: ts.Symbol,
	propertySignature: ts.PropertySignature | undefined,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.MemberNode {
	const { checker } = context;
	const symbolFilenames = getSymbolFileNames(propertySymbol);

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
	let parsedType: t.Node | undefined = undefined;
	if ((type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) && propertySignature) {
		parsedType = t.intrinsicNode('any');
		isOptional = Boolean(propertySignature.questionToken);
	} else {
		parsedType = resolveType(type, propertySymbol.getName(), context, skipResolvingComplexTypes);
		isOptional = Boolean(propertySymbol.flags & ts.SymbolFlags.Optional);
	}

	return t.memberNode(
		propertySymbol.getName(),
		parsedType,
		getDocumentationFromSymbol(propertySymbol, checker),
		isOptional,
		symbolFilenames,
		(propertySymbol as any).id,
	);
}

function getSymbolFileNames(symbol: ts.Symbol): Set<string> {
	const declarations = symbol.getDeclarations() || [];

	return new Set(declarations.map((declaration) => declaration.getSourceFile().fileName));
}
