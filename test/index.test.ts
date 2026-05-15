import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
import glob from 'fast-glob';
import { loadConfig, parseFromProgram } from '../src';

const regenerateOutput = process.env.UPDATE_OUTPUT === 'true';

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

const returnAliasSource = `type WithBase<T> = { [K in keyof T]: T[K] };
type PropsOf<T> = WithBase<T>;

export function getProps<T>(): PropsOf<T> {
  return undefined as any;
}`;
const classParameterAliasSource = `type AliasedAny = any;

export class ClassWithAliasedAny {
  constructor(ctorParam?: AliasedAny | undefined) {}

  method(methodParam?: AliasedAny | undefined): void {}
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

it('does not use diagnostic source nodes to change function return type names', () => {
	const filePath = '/virtual/return-alias.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, returnAliasSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				returnValueType: {
					typeName: {
						name: 'WithBase',
					},
				},
			},
		],
	});
});

it('preserves authored union aliases for class parameters', () => {
	const filePath = '/virtual/class-parameter-alias.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, classParameterAliasSource),
	);
	const aliasedAnyUnion = {
		kind: 'union',
		types: [
			{
				kind: 'intrinsic',
				intrinsic: 'any',
				typeName: {
					name: 'AliasedAny',
				},
			},
			{
				kind: 'intrinsic',
				intrinsic: 'undefined',
			},
		],
	};

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'class',
		constructSignatures: [
			{
				parameters: [
					{
						name: 'ctorParam',
						type: aliasedAnyUnion,
					},
				],
			},
		],
		methods: [
			{
				name: 'method',
				callSignatures: [
					{
						parameters: [
							{
								name: 'methodParam',
								type: aliasedAnyUnion,
							},
						],
					},
				],
			},
		],
	});
});
