import ts from 'typescript';

export function getSymbolId(symbol: ts.Symbol) {
	return (symbol as any).id;
}
