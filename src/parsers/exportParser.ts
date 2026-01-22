import ts from 'typescript';
import { ParserContext } from '../parser';
import { getDocumentationFromSymbol } from './documentationParser';
import { resolveType } from './typeResolver';
import { ExportNode, TypeName, type ExtendsTypeInfo } from '../models';
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

		// Collect namespace members from declaration merging (e.g., function X paired with namespace X)
		// These will be appended AFTER the main export for cleaner diffs
		const namespaceMembers: ExportNode[] = [];
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
						namespaceMembers.push(...memberExports);
					} else if (memberExports) {
						namespaceMembers.push(memberExports);
					}
				}
			}
		}

		// Results array - main export comes first, then namespace members
		const results: ExportNode[] = [];

		// Use the first declaration for the main export processing
		const exportDeclaration = declarations[0];

		if (ts.isModuleDeclaration(exportDeclaration)) {
			// Already handled above - return the namespace members
			return namespaceMembers.length > 0 ? namespaceMembers : undefined;
		}

		if (ts.isNamespaceExport(exportDeclaration)) {
			// Handle namespace re-export: export * as Name from './module'
			// The aliased symbol points to the source module
			const aliasedSymbol = checker.getAliasedSymbol(exportSymbol);
			if (!aliasedSymbol) return;

			// Get the exports of the module
			const members = checker.getExportsOfModule(aliasedSymbol);
			const nsName = exportSymbol.name;
			const namespaceResults: ExportNode[] = [];

			for (const member of members) {
				const memberExports = parseExport(member, parserContext, [...parentNamespaces, nsName]);
				if (Array.isArray(memberExports)) {
					namespaceResults.push(...memberExports);
				} else if (memberExports) {
					namespaceResults.push(memberExports);
				}
			}
			return namespaceResults;
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
								namespaceMembers.push(...memberExports);
							} else if (memberExports) {
								namespaceMembers.push(memberExports);
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

			// Track the full original name when re-exporting with an alias
			// e.g., `export { DialogTrigger as Trigger }` -> reexportedFrom: 'DialogTrigger'
			let reexportedFrom: string | undefined;
			if (isReExport && targetSymbol.name !== exportSymbol.name) {
				reexportedFrom = targetSymbol.name;
			}

			const mainExport = createExportNode(
				exportSymbol.name,
				targetSymbol,
				type,
				parentNamespaces,
				undefined,
				reexportedFrom,
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
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

			const mainExport = createExportNode(
				exportSymbol.name,
				exportedSymbol,
				checker.getTypeOfSymbol(exportedSymbol),
				parentNamespaces,
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
			return results.length > 0 ? results : undefined;
		} else if (
			ts.isVariableDeclaration(exportDeclaration) ||
			ts.isFunctionDeclaration(exportDeclaration)
		) {
			// export const x = ...
			// export function x() {}
			// export default function x() {}
			if (!exportDeclaration.name) {
				// Append namespace members after main export for cleaner diffs
				results.push(...namespaceMembers);
				return results.length > 0 ? results : undefined;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				// Append namespace members after main export for cleaner diffs
				results.push(...namespaceMembers);
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
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
			return results.length > 0 ? results : undefined;
		} else if (ts.isInterfaceDeclaration(exportDeclaration)) {
			// export interface X {}
			// export interface X extends Y {}
			if (!exportDeclaration.name) {
				return;
			}

			const exportedSymbol = checker.getSymbolAtLocation(exportDeclaration.name);
			if (!exportedSymbol) {
				return;
			}

			// Extract extends clause types
			const extendsTypes = extractExtendsTypes(exportDeclaration.heritageClauses, checker);

			const type = checker.getTypeAtLocation(exportDeclaration);
			const mainExport = createExportNode(
				exportSymbol.name,
				exportedSymbol,
				type,
				parentNamespaces,
				undefined,
				undefined,
				extendsTypes,
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
			return results.length > 0 ? results : undefined;
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
			const mainExport = createExportNode(
				exportSymbol.name,
				exportedSymbol,
				type,
				parentNamespaces,
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
			return results.length > 0 ? results : undefined;
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
			const mainExport = createExportNode(
				exportSymbol.name,
				exportedSymbol,
				type,
				parentNamespaces,
				exportDeclaration.type, // Pass the authored type node to preserve union structure
			);
			if (mainExport) {
				results.push(...mainExport);
			}
			// Append namespace members after main export for cleaner diffs
			results.push(...namespaceMembers);
			return results.length > 0 ? results : undefined;
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
		typeNode?: ts.TypeNode,
		reexportedFrom?: string,
		extendsTypes?: ExtendsTypeInfo[],
	) {
		const parsedType = resolveType(type, typeNode, parserContext);
		if (parsedType) {
			// Fix type name for external types that resolve to __type
			// This happens when re-exporting types from external packages
			// e.g., `export type { Rect } from '@floating-ui/utils'`
			// The resolved type loses the alias name and becomes __type
			if (
				'typeName' in parsedType &&
				(parsedType as { typeName: TypeName | undefined }).typeName?.name === '__type'
			) {
				const typeWithName = parsedType as { typeName: TypeName };
				typeWithName.typeName = new TypeName(
					name,
					typeWithName.typeName?.namespaces,
					typeWithName.typeName?.typeArguments,
				);
			}

			// If parentNamespaces are provided, update the type's typeName to use the export context
			// This is important for re-exports where the original type has different namespaces
			// e.g., `export { DialogPortal as Portal }` in NavigationMenu should produce
			// typeName = {namespaces: ['NavigationMenu'], name: 'Portal'} not {namespaces: ['DialogPortal'], name: 'State'}
			if (parentNamespaces.length > 0 && 'typeName' in parsedType) {
				const typeWithName = parsedType as { typeName: TypeName | undefined };
				// Always use the export context namespaces, not the original type's namespaces
				// The export name and parentNamespaces define how this type should be referenced
				typeWithName.typeName = new TypeName(
					name,
					parentNamespaces,
					typeWithName.typeName?.typeArguments,
				);
			}

			// Build the fully qualified export name including namespace path
			const exportName = parentNamespaces.length > 0 ? [...parentNamespaces, name].join('.') : name;

			return [
				new ExportNode(
					exportName,
					parsedType,
					getDocumentationFromSymbol(symbol, checker),
					reexportedFrom,
					extendsTypes,
				),
			];
		}
	}
}

/**
 * Extracts the type names from extends/implements clauses.
 * e.g., `interface X extends A, B.C` returns info for each extended type
 *
 * For utility types like Omit, Pick, Partial, etc., extracts the first type argument
 * as the base type being extended.
 */
function extractExtendsTypes(
	heritageClauses: ts.NodeArray<ts.HeritageClause> | undefined,
	checker: ts.TypeChecker,
): ExtendsTypeInfo[] | undefined {
	if (!heritageClauses) {
		return undefined;
	}

	// Utility types where the first type argument is the base type
	const utilityTypes = new Set(['Omit', 'Pick', 'Partial', 'Required', 'Readonly']);

	const extendsTypes: ExtendsTypeInfo[] = [];
	for (const clause of heritageClauses) {
		// Only process 'extends' clauses (SyntaxKind.ExtendsKeyword)
		// Skip 'implements' clauses for now
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}

		for (const typeExpr of clause.types) {
			const baseTypeName = typeExpr.expression.getText();

			// Check if this is a utility type wrapping another type
			// e.g., Omit<DialogRoot.Props, 'modal'> -> extract DialogRoot.Props
			if (
				utilityTypes.has(baseTypeName) &&
				typeExpr.typeArguments &&
				typeExpr.typeArguments.length > 0
			) {
				const firstTypeArg = typeExpr.typeArguments[0];
				// Get the base type name from the first type argument (without its own type arguments)
				const innerTypeName = ts.isTypeReferenceNode(firstTypeArg)
					? firstTypeArg.typeName.getText()
					: firstTypeArg.getText();

				// Try to resolve the actual symbol, following type alias chains
				const type = checker.getTypeAtLocation(firstTypeArg);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: innerTypeName };
				if (resolvedName && resolvedName !== innerTypeName && resolvedName !== '__type') {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			} else {
				// Regular extends clause
				const type = checker.getTypeAtLocation(typeExpr);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: baseTypeName };
				if (resolvedName && resolvedName !== baseTypeName && resolvedName !== '__type') {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			}
		}
	}

	return extendsTypes.length > 0 ? extendsTypes : undefined;
}

/**
 * Resolves the underlying symbol for a type, following type alias chains.
 * For generic type aliases like `type Props<T> = DialogProps<T>`, this returns
 * the symbol for `DialogProps` rather than `Props`.
 */
function resolveUnderlyingSymbol(type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined {
	const symbol = type.aliasSymbol ?? type.symbol;

	if (!symbol) {
		return undefined;
	}

	// For type aliases, follow the chain to find the underlying type
	// This handles generic type aliases like `type Props<T> = DialogProps<T>`
	const aliasDecl = symbol.declarations?.[0];
	if (aliasDecl && ts.isTypeAliasDeclaration(aliasDecl) && ts.isTypeReferenceNode(aliasDecl.type)) {
		// Get the symbol from the type reference name, not from the resolved type
		// This preserves the alias chain for generic types
		const targetTypeName = aliasDecl.type.typeName;
		const targetSymbol = checker.getSymbolAtLocation(targetTypeName);

		if (targetSymbol && targetSymbol.name !== '__type' && targetSymbol !== symbol) {
			// Check if the target is also a type alias - if so, recurse
			const targetDecl = targetSymbol.declarations?.[0];
			if (targetDecl && ts.isTypeAliasDeclaration(targetDecl)) {
				const targetType = checker.getDeclaredTypeOfSymbol(targetSymbol);
				const deeperSymbol = resolveUnderlyingSymbol(targetType, checker);
				if (deeperSymbol && deeperSymbol !== targetSymbol) {
					return deeperSymbol;
				}
			}
			return targetSymbol;
		}
	}

	return symbol;
}
