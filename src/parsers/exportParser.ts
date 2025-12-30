import ts from 'typescript';
import { ParserContext } from '../parser';
import { getDocumentationFromSymbol } from './documentationParser';
import { resolveType } from './typeResolver';
import { ExportNode, TypeName } from '../models';
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
			// Handle exported namespace (namespace X { ... })
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

		if (ts.isNamespaceExport(exportDeclaration)) {
			// Handle namespace re-export: export * as Name from './module'
			// The aliased symbol points to the source module
			const aliasedSymbol = checker.getAliasedSymbol(exportSymbol);
			if (!aliasedSymbol) return;

			// Get the exports of the module
			const members = checker.getExportsOfModule(aliasedSymbol);
			const nsName = exportSymbol.name;
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
			// export { x } from './module'
			// export { x as y } from './module'
			const isReExport =
				ts.isExportDeclaration(exportDeclaration.parent.parent) &&
				exportDeclaration.parent.parent.moduleSpecifier !== undefined;

			let targetSymbol: ts.Symbol | undefined;

			if (isReExport) {
				// For re-exports, we need to resolve the aliased symbol from the external module
				// exportSymbol already points to the correct target symbol
				targetSymbol = checker.getAliasedSymbol(exportSymbol);
				if (!targetSymbol || targetSymbol === exportSymbol) {
					// If aliased symbol resolution fails, try getExportSpecifierLocalTargetSymbol
					targetSymbol = checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
				}
			} else {
				// For local exports, use getExportSpecifierLocalTargetSymbol
				// `targetSymbol` is the symbol that the export specifier points to:
				// const x = 1;
				//       ^ - targetSymbol
				// export { x };
				//          ^ - exportDeclaration.symbol
				targetSymbol = checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
			}

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
		} else if (ts.isTypeAliasDeclaration(exportDeclaration)) {
			// export type X = ...
			if (!exportDeclaration.name) {
				return;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				return;
			}

			const type = checker.getTypeAtLocation(exportDeclaration);
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
			// If parentNamespaces are provided, merge them into the type's typeName
			// But only if they're not already present (avoid duplication)
			if (parentNamespaces.length > 0 && 'typeName' in parsedType) {
				const typeWithName = parsedType as { typeName: TypeName | undefined };
				if (typeWithName.typeName) {
					const existingNamespaces = typeWithName.typeName.namespaces ?? [];
					// Check if parentNamespaces are already a prefix of existing namespaces
					const isAlreadyPrefixed = parentNamespaces.every((ns, i) => existingNamespaces[i] === ns);
					if (!isAlreadyPrefixed) {
						typeWithName.typeName = new TypeName(
							typeWithName.typeName.name,
							[...parentNamespaces, ...existingNamespaces],
							typeWithName.typeName.typeArguments,
						);
					}
				} else {
					// Create a typeName with the namespace info if one doesn't exist
					typeWithName.typeName = new TypeName(name, parentNamespaces, undefined);
				}
			}

			// Build the fully qualified export name including namespace path
			const exportName = parentNamespaces.length > 0 ? [...parentNamespaces, name].join('.') : name;

			return [new ExportNode(exportName, parsedType, getDocumentationFromSymbol(symbol, checker))];
		}
	}
}
