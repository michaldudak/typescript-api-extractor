import ts from 'typescript';
import { ParserContext } from '../parser';
import { EnumNode, EnumMember } from '../types';
import { getDocumentationFromSymbol } from './documentationParser';

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
			(memberType as any).value,
			getDocumentationFromSymbol(memberSymbol, checker),
		);
	});

	return new EnumNode(symbol.getName(), members, getDocumentationFromSymbol(symbol, checker));
}
