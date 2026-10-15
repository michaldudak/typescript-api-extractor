import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { getAliasChainFlags, getDeclarationSpaces } from './declarationSpaces';
import { parseExport } from './exportParser';
import { hasValueExportPath } from './exportValuePaths';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Whether an export reached only through type-only sites still has something to
 * export: a type meaning anywhere along its alias chain, or a namespace that is
 * not merged onto a function or variable. A function or variable is dropped
 * along with any namespace merged onto it, since only its value would remain.
 */
function isRetainedWithoutValue(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const declarationSpaces = getDeclarationSpaces(symbol, checker);
	return (
		declarationSpaces.isType ||
		(declarationSpaces.isNamespace &&
			(getAliasChainFlags(symbol, checker) &
				(ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) ===
				0)
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
				if (isTypeOnlyExport && isStarExport && !isRetainedWithoutValue(exportedSymbol, checker)) {
					// A function or variable (with or without a merged namespace)
					// reached only through type-only sites exports nothing.
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
