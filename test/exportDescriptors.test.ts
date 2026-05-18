import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { type ParserContext } from '../src';
import { resolveExportDescriptors } from '../src/parsers/exportDescriptors';

function createInMemoryProgram(files: Record<string, string>): ts.Program {
	const rootNames = Object.keys(files);
	const compilerOptions: ts.CompilerOptions = {
		rootDir: path.dirname(rootNames[0]!),
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.Node16,
		moduleResolution: ts.ModuleResolutionKind.Node16,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
	};
	const host = ts.createCompilerHost(compilerOptions);
	const getSourceFile = host.getSourceFile.bind(host);

	host.getSourceFile = (sourceFileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const sourceText = files[sourceFileName];
		if (sourceText !== undefined) {
			return ts.createSourceFile(sourceFileName, sourceText, languageVersion, true);
		}

		return getSourceFile(sourceFileName, languageVersion, onError, shouldCreateNewSourceFile);
	};
	host.fileExists = (sourceFileName) =>
		files[sourceFileName] !== undefined || ts.sys.fileExists(sourceFileName);
	host.readFile = (sourceFileName) => files[sourceFileName] ?? ts.sys.readFile(sourceFileName);
	host.resolveModuleNames = (moduleNames, containingFile) =>
		moduleNames.map((moduleName) => {
			const candidate = path.resolve(path.dirname(containingFile), `${moduleName}.ts`);
			if (files[candidate] !== undefined) {
				return {
					resolvedFileName: candidate,
					extension: ts.Extension.Ts,
				};
			}

			return undefined;
		});

	return ts.createProgram(rootNames, compilerOptions, host);
}

function createDescriptorContext(filePath: string, program: ts.Program): ParserContext {
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Missing source file: ${filePath}`);
	}

	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];
	const context = {
		checker: program.getTypeChecker(),
		sourceFile,
		typeStack: [],
		compilerOptions: program.getCompilerOptions(),
		parsedSymbolStack,
		sourceNodeStack,
		program,
		resolvedTypeCache: new Map(),
		shouldInclude: () => true,
		shouldResolveObject: () => true,
		includeExternalTypes: false,
		onWarning: () => {},
		runWithSymbolScope: <T>(symbolName: string, callback: () => T): T => {
			parsedSymbolStack.push(symbolName);
			try {
				return callback();
			} finally {
				parsedSymbolStack.pop();
			}
		},
		runWithSourceNodeScope: <T>(sourceNode: ts.Node | undefined, callback: () => T): T => {
			if (sourceNode) {
				sourceNodeStack.push(sourceNode);
			}
			try {
				return callback();
			} finally {
				if (sourceNode) {
					sourceNodeStack.pop();
				}
			}
		},
		runWithTypeParameterSubstitutionScope: <T>(
			_substitutions: Map<ts.Symbol, ts.Type>,
			callback: () => T,
		): T => callback(),
	} as ParserContext;

	return context;
}

function getModuleExport(program: ts.Program, filePath: string, exportName: string): ts.Symbol {
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Missing source file: ${filePath}`);
	}

	const checker = program.getTypeChecker();
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) {
		throw new Error(`Missing module symbol: ${filePath}`);
	}

	const exportSymbol = checker
		.getExportsOfModule(moduleSymbol)
		.find((symbol) => symbol.name === exportName);
	if (!exportSymbol) {
		throw new Error(`Missing export: ${exportName}`);
	}

	return exportSymbol;
}

it('normalizes aliased re-exports and merged namespace members before node construction', () => {
	const inputPath = '/virtual/input.ts';
	const program = createInMemoryProgram({
		[inputPath]: "export { ComponentRoot as Root } from './source';",
		'/virtual/source.ts': `export function ComponentRoot(): void {}

export namespace ComponentRoot {
  export interface Props {
    value: string;
  }
}`,
	});
	const context = createDescriptorContext(inputPath, program);
	const exportSymbol = getModuleExport(program, inputPath, 'Root');

	const descriptors = resolveExportDescriptors(exportSymbol, context);

	// Descriptor order is part of the export contract: main export first, then
	// namespace members under the public alias path.
	expect(
		descriptors?.map((descriptor) => ({
			name: descriptor.name,
			parentNamespaces: descriptor.parentNamespaces,
			reexportedFrom: descriptor.reexportedFrom,
			scope: descriptor.symbolScope,
			symbolName: descriptor.symbol.name,
		})),
	).toEqual([
		{
			name: 'Root',
			parentNamespaces: [],
			reexportedFrom: 'ComponentRoot',
			scope: ['Root'],
			symbolName: 'ComponentRoot',
		},
		{
			name: 'Props',
			parentNamespaces: ['Root'],
			reexportedFrom: undefined,
			scope: ['Root', 'Props'],
			symbolName: 'Props',
		},
	]);
	expect(context.parsedSymbolStack).toEqual([]);
});
