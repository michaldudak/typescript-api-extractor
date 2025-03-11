import ts from 'typescript';
import * as t from '../types';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';

export function parseMember(
	propertySignature: ts.PropertySignature,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.MemberNode {
	const { checker } = context;
	const symbol = checker.getSymbolAtLocation(propertySignature.name);
	if (!symbol) {
		throw new Error(`No symbol found for property signature ${propertySignature.name.getText()}`);
	}

	const symbolFilenames = getSymbolFileNames(symbol);

	let type: ts.Type;
	if (!propertySignature.type) {
		type = checker.getAnyType();
	} else {
		type = checker.getTypeOfSymbolAtLocation(symbol, propertySignature.type);
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
		parsedType = resolveType(type, symbol.getName(), context, skipResolvingComplexTypes);
		isOptional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
	}

	return t.memberNode(
		symbol.getName(),
		parsedType,
		getDocumentationFromSymbol(symbol, checker),
		isOptional,
		symbolFilenames,
		(symbol as any).id,
	);
}

function getSymbolFileNames(symbol: ts.Symbol): Set<string> {
	const declarations = symbol.getDeclarations() || [];

	return new Set(declarations.map((declaration) => declaration.getSourceFile().fileName));
}
