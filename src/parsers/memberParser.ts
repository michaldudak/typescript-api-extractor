import ts from 'typescript';
import * as t from '../types';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';

export function parseMember(
	symbol: ts.Symbol,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.MemberNode {
	const { checker } = context;
	const declarations = symbol.getDeclarations();
	const declaration = declarations && declarations[0];

	const symbolFilenames = getSymbolFileNames(symbol);

	if (!declaration) {
		throw new Error(`No declaration found for symbol ${symbol.getName()}`);
	}

	const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
	let isOptional = false;

	// Typechecker only gives the type "any" if it's present in a union
	// This means the type of "a" in {a?:any} isn't "any | undefined"
	// So instead we check for the questionmark to detect optional types
	let parsedType: t.Node | undefined = undefined;
	if (
		(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) &&
		declaration &&
		ts.isPropertySignature(declaration)
	) {
		parsedType = t.intrinsicNode('any');
		isOptional = Boolean(declaration.questionToken);
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
