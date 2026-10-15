import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { parseExport } from './exportParser';
import { hasValueExportPath } from './exportValuePaths';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Whether a symbol names a type (interface, type alias, enum, class), judged by the
 * declaration a re-export such as `export type { Props } from './types'` resolves to.
 * A function merged with a namespace does not: the namespace's members are types,
 * the merged symbol is not.
 */
function hasTypeMeaning(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return ((symbol.flags | target.flags) & ts.SymbolFlags.Type) !== 0;
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
				if (isTypeOnlyExport && isStarExport && !hasTypeMeaning(exportedSymbol, checker)) {
					// A value without a type meaning (like a function with a merged
					// namespace) reached only through type-only sites exports nothing.
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
