import ts from 'typescript';
import { ParserContext } from '../parser';
import { EnumNode, EnumMember, enumNode } from '../types';
import { getDocumentationFromNode, getDocumentationFromSymbol } from './documentationParser';

export function parseEnum(symbol: ts.Symbol, context: ParserContext): EnumNode {
	const { checker } = context;
	const memberSymbols = checker.getExportsOfModule(symbol);
	const members = memberSymbols.map((memberSymbol) => {
		if (!memberSymbol) {
			throw new Error('Could not find symbol for member');
		}

		const memberType = checker.getTypeOfSymbol(memberSymbol);

		return {
			name: memberSymbol.getName(),
			value: (memberType as any).value,
			documentation: getDocumentationFromSymbol(memberSymbol, checker),
		} satisfies EnumMember;
	});

	return enumNode(symbol.getName(), members, getDocumentationFromSymbol(symbol, checker));
}
