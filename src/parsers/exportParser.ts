import ts from 'typescript';
import { ParserContext } from '../parser';
import { getDocumentationFromSymbol } from './documentationParser';
import { resolveType } from './typeResolver';
import { ExportNode } from '../models';
import { ParserError } from '../ParserError';

export function parseExport(
	exportSymbol: ts.Symbol,
	parserContext: ParserContext,
	parentNamespaces: string[] = [],
): ExportNode[] | undefined {
	const { checker, sourceFile, parsedSymbolStack } = parserContext;
	parsedSymbolStack.push(exportSymbol.name);

	try {
		const exportDeclaration = exportSymbol.declarations?.[0];
		if (!exportDeclaration) {
			return;
		}

		if (ts.isModuleDeclaration(exportDeclaration)) {
			// Handle exported namespace
			const namespaceSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!namespaceSymbol) return;
			const members = checker.getExportsOfModule(namespaceSymbol);
			const nsName = exportDeclaration.name.getText();
			const results: ExportNode[] = [];
			for (const member of members) {
				const memberExports = parseExport(member, parserContext, [...parentNamespaces, nsName]);
				if (Array.isArray(memberExports)) {
					results.push(...memberExports);
				} else if (memberExports) {
					results.push(memberExports);
				}
			}
			return results;
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

			let type: ts.Type;
			if (targetSymbol.declarations?.length) {
				type = checker.getTypeAtLocation(targetSymbol.declarations[0]);
			} else {
				type = checker.getTypeOfSymbol(targetSymbol);
			}
			return createExportNode(exportSymbol.name, targetSymbol, type, parentNamespaces);
		} else if (ts.isExportAssignment(exportDeclaration)) {
			// export default x
			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.expression);
			if (!exportedSymbol) {
				console.error(
					'Failed to get the symbol of the default export in file:',
					sourceFile.fileName,
				);
				return;
			}

			return createExportNode(
				exportSymbol.name,
				exportedSymbol,
				checker.getTypeOfSymbol(exportedSymbol),
				parentNamespaces,
			);
		} else if (
			ts.isVariableDeclaration(exportDeclaration) ||
			ts.isFunctionDeclaration(exportDeclaration)
		) {
			// export const x = ...
			// export function x() {}
			// export default function x() {}
			if (!exportDeclaration.name) {
				return;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				return;
			}

			const type = checker.getTypeOfSymbol(exportedSymbol);
			return createExportNode(exportSymbol.name, exportedSymbol, type, parentNamespaces);
		} else if (ts.isInterfaceDeclaration(exportDeclaration)) {
			// export interface X {}
			if (!exportDeclaration.name) {
				return;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				return;
			}

			const type = checker.getTypeAtLocation(exportDeclaration);
			return createExportNode(exportSymbol.name, exportedSymbol, type, parentNamespaces);
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
			return createExportNode(exportSymbol.name, exportedSymbol, type, parentNamespaces);
		}
	} catch (error) {
		if (!(error instanceof ParserError)) {
			throw new ParserError(error, parsedSymbolStack);
		} else {
			throw error;
		}
	} finally {
		parsedSymbolStack.pop();
	}

	function createExportNode(
		name: string,
		symbol: ts.Symbol,
		type: ts.Type,
		parentNamespaces: string[],
	) {
		const parsedType = resolveType(type, undefined, parserContext);
		if (parsedType) {
			// Patch parentNamespaces if the type supports it
			if (parsedType && 'parentNamespaces' in parsedType) {
				parsedType.parentNamespaces = parentNamespaces;
			}
			return [new ExportNode(name, parsedType, getDocumentationFromSymbol(symbol, checker))];
		}
	}
}
