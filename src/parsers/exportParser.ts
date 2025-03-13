import ts from 'typescript';
import { ParserContext } from '../parser';
import { getDocumentationFromSymbol } from './documentationParser';
import { resolveType } from './typeResolver';
import * as t from '../types';

export function parseExport(
	exportSymbol: ts.Symbol,
	parserContext: ParserContext,
): t.ExportNode | undefined {
	const { checker, sourceFile } = parserContext;

	const exportDeclaration = exportSymbol.declarations?.[0];
	if (!exportDeclaration) {
		return;
	}

	if (ts.isExportSpecifier(exportDeclaration)) {
		// export { x }
		// export { x as y }
		if (
			ts.isExportDeclaration(exportDeclaration.parent.parent) &&
			exportDeclaration.parent.parent.moduleSpecifier !== undefined
		) {
			// Skip export ... from "..." statements (re-exports).
			// They will be processed when parsing the file they point to.
			return;
		}

		// `targetSymbol` is the symbol that the export specifier points to:
		// const x = 1;
		//       ^ - targetSymbol
		// export { x };
		//          ^ - exportDeclaration.symbol
		const targetSymbol = checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
		if (!targetSymbol) {
			return;
		}

		const type = checker.getTypeOfSymbol(targetSymbol);
		return createExportNode(exportSymbol.name, targetSymbol, type);
	} else if (ts.isExportAssignment(exportDeclaration)) {
		// export default x
		const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.expression);
		if (!exportedSymbol) {
			console.error('Failed to get the symbol of the default export in file:', sourceFile.fileName);
			return;
		}

		return createExportNode(
			exportSymbol.name,
			exportedSymbol,
			checker.getTypeOfSymbol(exportedSymbol),
		);
	} else if (
		ts.isVariableDeclaration(exportDeclaration) ||
		ts.isFunctionDeclaration(exportDeclaration)
	) {
		// export const x = ...
		// export function x() {}
		if (!exportDeclaration.name) {
			return;
		}

		const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
		if (!exportedSymbol) {
			return;
		}

		const type = checker.getTypeOfSymbol(exportedSymbol);
		return createExportNode(exportSymbol.name, exportedSymbol, type);
	} else if (ts.isEnumDeclaration(exportDeclaration)) {
		// export enum x {}
		if (!exportDeclaration.name) {
			return;
		}

		const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
		if (!exportedSymbol) {
			return;
		}

		if (!exportedSymbol.declarations?.[0]) {
			console.warn('Could not find the declaration of the enum:', exportedSymbol.name);
			return;
		}

		const type = checker.getTypeAtLocation(exportedSymbol.declarations[0]);
		return createExportNode(exportSymbol.name, exportedSymbol, type);
	}

	function createExportNode(name: string, symbol: ts.Symbol, type: ts.Type) {
		const parsedType = resolveType(type, symbol.getName(), parserContext);
		if (parsedType) {
			return new t.ExportNode(name, parsedType, getDocumentationFromSymbol(symbol, checker));
		}
	}
}
