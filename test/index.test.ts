import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { afterEach, it, expect, vi } from 'vitest';
import glob from 'fast-glob';
import {
	loadConfig,
	parseFromProgram,
	type ParserContext,
	type ParserOptions,
	type ParserWarning,
} from '../src';
import { parseExport } from '../src/parsers/exportParser';

const regenerateOutput = process.env.UPDATE_OUTPUT === 'true';

afterEach(() => {
	vi.restoreAllMocks();
});

let testCases = glob.sync('**/input.{d.ts,ts,tsx}', { absolute: true, cwd: __dirname });
if (testCases.some((t) => t.includes('.only'))) {
	testCases = testCases.filter((t) => t.includes('.only'));
}

const program = ts.createProgram(
	testCases,
	loadConfig(path.resolve(__dirname, 'tsconfig.json')).options,
);

for (const testCase of testCases) {
	const dirname = path.dirname(testCase);
	const testName = dirname.slice(__dirname.length + 1);
	const expectedOutput = path.join(dirname, 'output.json');

	it.skipIf(testCase.includes('.skip'))(testName, async () => {
		const moduleDefinition = parseFromProgram(testCase, program);

		if (!regenerateOutput && fs.existsSync(expectedOutput)) {
			expect(moduleDefinition).toMatchObject(JSON.parse(fs.readFileSync(expectedOutput, 'utf8')));
		} else {
			fs.writeFileSync(expectedOutput, JSON.stringify(moduleDefinition, null, '\t'));
		}
	});
}

const unsupportedTypeSource = 'export type X<T> = T extends string ? T : never;';
const preciseWarningSource = `export function functionReturn<T>():
  T extends string ? T : never {
  return undefined as any;
}

export class ClassWarnings {
  methodParam<T>(
    value: T extends string ? T : never,
  ): void {}

  methodReturn<T>():
    T extends string ? T : never {
    return undefined as any;
  }
}`;

function createInMemoryProgram(filePath: string, sourceText: string): ts.Program {
	const compilerOptions: ts.CompilerOptions = {
		rootDir: path.dirname(filePath),
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
		if (sourceFileName === filePath) {
			return ts.createSourceFile(sourceFileName, sourceText, languageVersion, true);
		}

		return getSourceFile(sourceFileName, languageVersion, onError, shouldCreateNewSourceFile);
	};
	host.fileExists = (sourceFileName) =>
		sourceFileName === filePath || ts.sys.fileExists(sourceFileName);
	host.readFile = (sourceFileName) =>
		sourceFileName === filePath ? sourceText : ts.sys.readFile(sourceFileName);

	return ts.createProgram([filePath], compilerOptions, host);
}

function getExpectedUnsupportedTypeWarningMessage(filePath: string): string {
	return `Type extraction warning: Unable to handle type "T" with flag "Substitution" while resolving "T extends string ? T : never" at "${filePath}:1:20". Using any instead.`;
}

it('reports unsupported type fallbacks through onWarning', () => {
	const filePath = '/virtual/unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const parserOptions: ParserOptions = {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	};

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource), parserOptions);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'unsupported-type-fallback',
		filePath,
		line: 1,
		column: 20,
		parsedSymbolStack: [filePath, 'X'],
		typeFlags: ['Substitution'],
		typeText: 'T',
		sourceText: 'T extends string ? T : never',
	});
	expect(warnings[0]!.message).toBe(getExpectedUnsupportedTypeWarningMessage(filePath));
	expect(warnings[0]!.message).toContain('Type extraction warning:');
	expect(warnings[0]!.message).not.toContain('IncludesInstantiable');
});

it('logs unsupported type fallbacks by default', () => {
	const filePath = '/virtual/default-unsupported-type-warning.ts';
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource));

	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn).toHaveBeenCalledWith(getExpectedUnsupportedTypeWarningMessage(filePath));
});

it('reports precise type locations in function and class signatures', () => {
	const filePath = '/virtual/precise-warning-locations.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, preciseWarningSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				line: 2,
				column: 3,
				sourceText: 'T extends string ? T : never',
				parsedSymbolStack: [filePath, 'functionReturn'],
			}),
			expect.objectContaining({
				line: 8,
				column: 12,
				sourceText: 'T extends string ? T : never',
				parsedSymbolStack: [filePath, 'ClassWarnings', 'parameter: value'],
			}),
			expect.objectContaining({
				line: 12,
				column: 5,
				sourceText: 'T extends string ? T : never',
				parsedSymbolStack: [filePath, 'ClassWarnings'],
			}),
		]),
	);
	for (const warning of unsupportedWarnings) {
		expect(warning.line).not.toBe(1);
		expect(warning.column).not.toBe(1);
	}
});

it('reports missing enum declarations through onWarning', () => {
	const sourceFile = ts.createSourceFile(
		'/virtual/missing-enum-declaration.ts',
		'export enum Missing {}',
		ts.ScriptTarget.ES2022,
		true,
	);
	const enumDeclaration = sourceFile.statements[0]!;
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const context = {
		checker: {
			getSymbolAtLocation: () => ({ name: 'Missing' }),
		},
		sourceFile,
		parsedSymbolStack: [],
		onWarning: (warning: ParserWarning) => {
			warnings.push(warning);
		},
	} as unknown as ParserContext;

	parseExport(
		{
			name: 'Missing',
			declarations: [enumDeclaration],
		} as unknown as ts.Symbol,
		context,
	);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'missing-enum-declaration',
		filePath: sourceFile.fileName,
		line: 1,
		column: 1,
		parsedSymbolStack: ['Missing'],
		enumName: 'Missing',
	});
});
