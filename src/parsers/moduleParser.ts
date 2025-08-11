import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { ParserContext } from '../parser';
import { parseExport } from './exportParser';
import { augmentComponentNodes } from './componentParser';
import { ParserError } from '../ParserError';

export function parseModule(sourceFile: ts.SourceFile, context: ParserContext): ModuleNode {
	const { checker, compilerOptions, parsedSymbolStack } = context;
	parsedSymbolStack.push(sourceFile.fileName);

	try {
		const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
		if (!sourceFileSymbol) {
			throw new Error('Failed to get the source file symbol');
		}

		let parsedModuleExports: ExportNode[] = [];
		const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

		for (const exportedSymbol of exportedSymbols) {
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
