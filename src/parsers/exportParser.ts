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
		const declarations = exportSymbol.declarations;
		if (!declarations || declarations.length === 0) {
			return;
		}

		// Check all declarations for namespace declarations (declaration merging)
		// e.g., export function X() {} paired with export namespace X { export type Props = ... }
		// Use the export name (not the declaration name) so that re-exports work correctly
		// e.g., `export { ComponentRoot as Root }` with `namespace ComponentRoot { export type Props = ... }`
		// should produce `Component.Root.Props`, not `ComponentRoot.Props`
		const results: ExportNode[] = [];
		for (const declaration of declarations) {
			if (ts.isModuleDeclaration(declaration)) {
				// Handle exported namespace (namespace X { ... })
				const namespaceSymbol = checker.getSymbolAtLocation(declaration.name);
				if (!namespaceSymbol) continue;
				const members = checker.getExportsOfModule(namespaceSymbol);
				// Use exportSymbol.name (the exported name) not declaration.name.getText() (the original name)
				// This ensures re-exports like `{ ComponentRoot as Root }` use "Root" not "ComponentRoot"
				for (const member of members) {
					const memberExports = parseExport(member, parserContext, [
						...parentNamespaces,
						exportSymbol.name,
					]);
					if (Array.isArray(memberExports)) {
						results.push(...memberExports);
					} else if (memberExports) {
						results.push(memberExports);
					}
				}
			}
		}

		// Use the first declaration for the main export processing
		const exportDeclaration = declarations[0];

		if (ts.isModuleDeclaration(exportDeclaration)) {
			// Already handled above - return the namespace members
			return results.length > 0 ? results : undefined;
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

			// Check the TARGET symbol's declarations for namespace members (declaration merging)
			// e.g., `export { ComponentRoot as Root }` where ComponentRoot has a merged namespace
			// We use exportSymbol.name (the alias "Root") so we get "Component.Root.Props" not "ComponentRoot.Props"
			const targetDeclarations = targetSymbol.declarations;
			if (targetDeclarations) {
				for (const decl of targetDeclarations) {
					if (ts.isModuleDeclaration(decl)) {
						const namespaceSymbol = checker.getSymbolAtLocation(decl.name);
						if (!namespaceSymbol) continue;
						const members = checker.getExportsOfModule(namespaceSymbol);
						for (const member of members) {
							const memberExports = parseExport(member, parserContext, [
								...parentNamespaces,
								exportSymbol.name, // Use the alias name, not the original name
							]);
							if (Array.isArray(memberExports)) {
								results.push(...memberExports);
							} else if (memberExports) {
								results.push(memberExports);
							}
						}
					}
				}
			}

			// Get the type. For exports of imported types (e.g., `export type { X }`),
			// the targetSymbol may be an ImportSpecifier. In that case, getTypeAtLocation
			// on the import specifier can return `any` if the module resolution fails.
			// Using getTypeAtLocation on the export specifier itself works more reliably.
			let type: ts.Type;
			const targetDecl = targetSymbol.declarations?.[0];
			if (targetDecl && ts.isImportSpecifier(targetDecl)) {
				// For re-exports of imported types, use the export specifier directly
				// This handles cases like: import { X } from './m.js'; export type { X }
				type = checker.getTypeAtLocation(exportDeclaration);
			} else if (targetDecl) {
				type = checker.getTypeAtLocation(targetDecl);
			} else {
				type = checker.getTypeOfSymbol(targetSymbol);
			}
			const mainExport = createExportNode(exportSymbol.name, targetSymbol, type, parentNamespaces);
			if (mainExport) {
				results.push(...mainExport);
			}
			return results.length > 0 ? results : undefined;
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
				return results.length > 0 ? results : undefined;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				return results.length > 0 ? results : undefined;
			}

			const type = checker.getTypeOfSymbol(exportedSymbol);
			const mainExport = createExportNode(
				exportSymbol.name,
				exportedSymbol,
				type,
				parentNamespaces,
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			return results.length > 0 ? results : undefined;
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
						// Use the export name (which may be an alias) instead of the original type name
						// e.g., `{ ComponentRoot as Root }` should use "Root", not "ComponentRoot"
						typeWithName.typeName = new TypeName(
							name,
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
