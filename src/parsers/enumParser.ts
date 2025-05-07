import ts from 'typescript';
import { ParserContext } from '../parser';
import { EnumNode, EnumMember } from '../models';
import { getDocumentationFromSymbol } from './documentationParser';
import { getTypeNamespaces } from './typeResolver';

export function parseEnum(symbol: ts.Symbol, context: ParserContext): EnumNode {
	const { checker } = context;
	const memberSymbols = checker.getExportsOfModule(symbol);
	const members = memberSymbols.map((memberSymbol) => {
		if (!memberSymbol) {
			throw new Error('Could not find symbol for member');
		}

		const memberType = checker.getTypeOfSymbol(memberSymbol);

		return new EnumMember(
			memberSymbol.getName(),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(memberType as any).value,
			getDocumentationFromSymbol(memberSymbol, checker),
		);
	});

	const symbolType = checker.getTypeOfSymbol(symbol);

	return new EnumNode(
		symbol.getName(),
		getTypeNamespaces(symbolType),
		members,
		getDocumentationFromSymbol(symbol, checker),
	);
}
