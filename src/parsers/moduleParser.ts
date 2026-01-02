import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { ParserContext } from '../parser';
import { parseExport } from './exportParser';
import { augmentComponentNodes } from './componentParser';
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
 * Builds a set of module specifiers that are re-exported with `export type *`.
 * These modules should only have their type exports included, not values.
 */
function getTypeOnlyStarExportModules(sourceFile: ts.SourceFile): Set<string> {
	const typeOnlyModules = new Set<string>();

	for (const statement of sourceFile.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			statement.isTypeOnly &&
			!statement.exportClause && // Star export (no explicit exports listed)
			statement.moduleSpecifier &&
			ts.isStringLiteral(statement.moduleSpecifier)
		) {
			typeOnlyModules.add(statement.moduleSpecifier.text);
		}
	}

	return typeOnlyModules;
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

export function parseModule(sourceFile: ts.SourceFile, context: ParserContext): ModuleNode {
	const { checker, compilerOptions, parsedSymbolStack } = context;
	parsedSymbolStack.push(sourceFile.fileName);

	try {
		const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
		if (!sourceFileSymbol) {
			throw new Error('Failed to get the source file symbol');
		}

		// Find modules that are re-exported with `export type *`
		const typeOnlyStarExportModules = getTypeOnlyStarExportModules(sourceFile);

		// Build a set of source files that correspond to type-only star exports
		const typeOnlySourceFiles = new Set<ts.SourceFile>();
		const program = context.program;
		for (const moduleSpecifier of typeOnlyStarExportModules) {
			const resolved = resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName, program);
			if (resolved) {
				typeOnlySourceFiles.add(resolved);
			}
		}

		let parsedModuleExports: ExportNode[] = [];
		const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

		for (const exportedSymbol of exportedSymbols) {
			// Check if this symbol comes from a type-only star export module
			// If so, skip it if it's not a pure type
			const declarations = exportedSymbol.declarations;
			if (declarations && declarations.length > 0) {
				const symbolSourceFile = declarations[0].getSourceFile();
				if (typeOnlySourceFiles.has(symbolSourceFile) && !isPureType(exportedSymbol)) {
					// This is a value (like a function with merged namespace) from a type-only export
					// Skip it - TypeScript doesn't actually export it
					continue;
				}
			}

			const parsedExport = parseExport(exportedSymbol, context);
			if (!parsedExport) {
				continue;
			}
			if (Array.isArray(parsedExport)) {
				parsedModuleExports.push(...parsedExport);
			} else {
				parsedModuleExports.push(parsedExport);
			}
		}

		parsedModuleExports = augmentComponentNodes(parsedModuleExports, context);

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
			throw new ParserError(error, parsedSymbolStack);
		} else {
			throw error;
		}
	} finally {
		parsedSymbolStack.pop();
	}
}
