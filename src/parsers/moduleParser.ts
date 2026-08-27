import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { parseExport } from './exportParser';
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
 * Builds the sets of module specifiers re-exported with `export *`, split by whether the
 * re-export is type-only. A type-only star export contributes only the module's type
 * exports; a plain one contributes its values too.
 */
function getStarExportModules(sourceFile: ts.SourceFile): {
	typeOnly: Set<string>;
	value: Set<string>;
} {
	const typeOnly = new Set<string>();
	const value = new Set<string>();

	for (const statement of sourceFile.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			!statement.exportClause && // Star export (no explicit exports listed)
			statement.moduleSpecifier &&
			ts.isStringLiteral(statement.moduleSpecifier)
		) {
			const modules = statement.isTypeOnly ? typeOnly : value;
			modules.add(statement.moduleSpecifier.text);
		}
	}

	return { typeOnly, value };
}

/**
 * Resolves a module specifier to its source file.
 */
function resolveModuleSpecifier(
	moduleSpecifier: string,
	containingFile: string,
	program: ts.Program,
): ts.SourceFile | undefined {
	const compilerOptions = program.getCompilerOptions();
	const resolved = ts.resolveModuleName(moduleSpecifier, containingFile, compilerOptions, {
		fileExists: (fileName) => program.getSourceFile(fileName) !== undefined,
		readFile: () => undefined,
	});

	if (resolved.resolvedModule) {
		return program.getSourceFile(resolved.resolvedModule.resolvedFileName);
	}

	return undefined;
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

			// Find modules that are re-exported with `export *`, type-only or not
			const starExportModules = getStarExportModules(sourceFile);
			const program = context.program;

			// Resolve to source files rather than compare specifiers, so two spellings of
			// the same module are recognized as one.
			const valueStarSourceFiles = new Set<ts.SourceFile>();
			for (const moduleSpecifier of starExportModules.value) {
				const resolved = resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName, program);
				if (resolved) {
					valueStarSourceFiles.add(resolved);
				}
			}

			// Build a set of source files that correspond to type-only star exports
			const typeOnlySourceFiles = new Set<ts.SourceFile>();
			for (const moduleSpecifier of starExportModules.typeOnly) {
				const resolved = resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName, program);
				// A module also reached by a plain `export *` still exports its values, so the
				// type-only re-export adds nothing to take away.
				if (resolved && !valueStarSourceFiles.has(resolved)) {
					typeOnlySourceFiles.add(resolved);
				}
			}

			let parsedModuleExports: ExportNode[] = [];
			const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

			for (const exportedSymbol of exportedSymbols) {
				// Check if this symbol comes from a type-only star export module
				// If so, skip it if it's not a pure type
				const declarations = exportedSymbol.declarations;
				let isTypeOnlyStarExport = false;
				if (declarations && declarations.length > 0) {
					// Type-only-ness is attributed to the declaring file, not the export
					// path: when the same module is reached by both `export *` and
					// `export type *`, its exports count as type-only.
					const symbolSourceFile = declarations[0].getSourceFile();
					isTypeOnlyStarExport = typeOnlySourceFiles.has(symbolSourceFile);
					if (isTypeOnlyStarExport && !isPureType(exportedSymbol)) {
						// This is a value (like a function with merged namespace) from a type-only export
						// Skip it - TypeScript doesn't actually export it
						continue;
					}
				}

				const parsedExports = parseExport(exportedSymbol, context, [], isTypeOnlyStarExport);
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
