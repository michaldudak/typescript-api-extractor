import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { parseExport } from './exportParser';
import { hasValueExportPath } from './exportValuePaths';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Checks if a symbol is a pure type (interface, type alias, enum) with no value component.
 * A merged declaration (function + namespace) is NOT a pure type.
 */
function isPureType(symbol: ts.Symbol): boolean {
	const declarations = symbol.declarations;
	if (!declarations || declarations.length === 0) {
		return false;
	}

	// Check all declarations - if ANY is a value declaration, it's not a pure type
	for (const decl of declarations) {
		if (
			ts.isFunctionDeclaration(decl) ||
			ts.isVariableDeclaration(decl) ||
			ts.isClassDeclaration(decl)
		) {
			return false;
		}
	}

	// Only interfaces, type aliases, and enums are pure types
	return declarations.every(
		(decl) =>
			ts.isInterfaceDeclaration(decl) ||
			ts.isTypeAliasDeclaration(decl) ||
			ts.isEnumDeclaration(decl),
	);
}

/**
 * Parses a source file into a ModuleNode: resolves every module export, drops
 * values re-exported through `export type *`, then applies post-parse export
 * transforms such as the React component transform.
 */
export function parseModule(sourceFile: ts.SourceFile, context: ScopedParserContext): ModuleNode {
	const { checker, compilerOptions } = context;

	return context.runWithSymbolScope(sourceFile.fileName, () => {
		try {
			const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
			if (!sourceFileSymbol) {
				throw new Error('Failed to get the source file symbol');
			}

			let parsedModuleExports: ExportNode[] = [];
			const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

			for (const exportedSymbol of exportedSymbols) {
				const isTypeOnlyExport = !hasValueExportPath(
					sourceFileSymbol,
					exportedSymbol.escapedName,
					checker,
				);
				const isStarExport = !sourceFileSymbol.exports?.has(exportedSymbol.escapedName);
				if (isTypeOnlyExport && isStarExport && !isPureType(exportedSymbol)) {
					// A value (like a function with merged namespace) reached only through
					// `export type *` is not exported by TypeScript at all.
					continue;
				}

				const parsedExports = parseExport(exportedSymbol, context, [], isTypeOnlyExport);
				if (!parsedExports) {
					continue;
				}
				parsedModuleExports.push(...parsedExports);
			}

			parsedModuleExports = applyExportTransforms(parsedModuleExports, context);

			const relativeModulePath = path
				.relative(compilerOptions.rootDir!, JSON.parse(sourceFileSymbol.name))
				.replace(/\\/g, '/');

			const imports: string[] = sourceFile.statements
				.filter((s) => ts.isImportDeclaration(s) && s.moduleSpecifier)
				.map((statement) => {
					const importDeclaraion = statement as ts.ImportDeclaration;
					const text = importDeclaraion.moduleSpecifier.getText();
					return text.substring(1, text.length - 1); // Remove quotes
				});

			return new ModuleNode(
				relativeModulePath,
				parsedModuleExports,
				imports.length > 0 ? imports : undefined,
			);
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}
