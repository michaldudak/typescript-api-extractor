import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { afterEach, it, expect, vi } from 'vitest';
import glob from 'fast-glob';
import { loadConfig, parseFromProgram, type ParserWarning } from '../src';

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
	return `Type extraction warning: Unable to handle a type with flag "Substitution" in "${filePath}". Using any instead.`;
}

it('reports unsupported type fallbacks through onWarning', () => {
	const filePath = '/virtual/unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'unsupported-type-fallback',
		filePath,
		parsedSymbolStack: [filePath, 'X'],
		typeFlags: ['Substitution'],
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
