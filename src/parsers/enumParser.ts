import ts from 'typescript';
import { ParserContext } from '../parser';
import { EnumNode, EnumMember } from '../models';
import { getDocumentationFromSymbol } from './documentationParser';
import { getTypeNamespaces } from './common';
import { ParserError } from '../ParserError';
import { TypeName } from '../models/typeName';

export function parseEnum(symbol: ts.Symbol, context: ParserContext): EnumNode {
	const { checker, parsedSymbolStack } = context;
	parsedSymbolStack.push(symbol.name);

	try {
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

		const namespaces = getTypeNamespaces(symbolType);

		return new EnumNode(
			new TypeName(symbol.getName(), namespaces.length > 0 ? namespaces : undefined),
			members,
			getDocumentationFromSymbol(symbol, checker),
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
