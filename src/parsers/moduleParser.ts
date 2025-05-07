import path from 'node:path';
import ts from 'typescript';
import { ExportNode, ModuleNode } from '../models';
import { ParserContext } from '../parser';
import { parseExport } from './exportParser';
import { augmentComponentNodes } from './componentParser';

export function parseModule(sourceFile: ts.SourceFile, context: ParserContext): ModuleNode {
	const { checker, compilerOptions } = context;
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

	return new ModuleNode(relativeModulePath, parsedModuleExports);
}
