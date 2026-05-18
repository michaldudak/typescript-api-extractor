import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
import glob from 'fast-glob';
import { loadConfig, parseFromProgram, type ParserWarning } from '../src';
import { createInMemoryProgram } from './support/inMemoryProgram';

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
			expect(JSON.parse(JSON.stringify(moduleDefinition))).toEqual(
				JSON.parse(fs.readFileSync(expectedOutput, 'utf8')),
			);
		} else {
			fs.writeFileSync(expectedOutput, `${JSON.stringify(moduleDefinition, null, '\t')}\n`);
		}
	});
}

it('applies shouldInclude to finite mapped properties', async () => {
	const testCase = path.resolve(__dirname, 'mapped-alias-finite-key/input.ts');
	const moduleDefinition = parseFromProgram(testCase, program, {
		shouldInclude: ({ name }) => name !== 'b',
	});
	const serializedModuleDefinition = JSON.parse(JSON.stringify(moduleDefinition));
	const specializedExport = serializedModuleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Specialized',
	);

	expect(
		specializedExport.type.properties.map((property: { name: string }) => property.name),
	).toEqual(['a']);
});

const substitutionTypeSource = 'export type X<T> = T extends string ? T : never;';
const substitutionTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? T : never;';
const substitutionObjectTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? { v: T } : never;';
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
const sharedSignatureDefaultsSource = `const defaultOptions = { dense: true };

/**
 * @param options - Function options.
 */
export function configure(options = defaultOptions, inline = { compact: true }): void {}

export class Configurator {
  /**
   * @param options - Constructor options.
   */
  constructor(options = defaultOptions) {}

  /**
   * @param options - Method options.
   */
  configure(options = defaultOptions, inline = { compact: true }): void {}
}`;

it('resolves substitution types from representable base types', () => {
	const filePath = '/virtual/substitution-fallback.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionTypeSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeParameter',
				name: 'T',
			},
		],
	});
});

it('does not report unsupported warnings when a substitution fallback succeeds', () => {
	const filePath = '/virtual/substitution-fallback-warning.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionTypeWithUnsupportedConstraintSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'intrinsic',
				intrinsic: 'string',
			},
		],
	});
	expect(warnings).toEqual([]);
});

it('reports conditional name warnings when the resolved type keeps the conditional alias name', () => {
	const filePath = '/virtual/substitution-fallback-object-warning.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionObjectTypeWithUnsupportedConstraintSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		typeName: {
			name: 'X',
			typeArguments: [
				{
					type: {
						kind: 'typeParameter',
						name: 'T',
						constraint: {
							kind: 'intrinsic',
							intrinsic: 'any',
						},
					},
				},
			],
		},
		properties: [
			{
				name: 'v',
			},
		],
	});
	expect(warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: 'unsupported-type-fallback',
				typeFlags: ['TemplateLiteral'],
				typeText: '`prefix-${string}`',
				sourceText: 'T extends string ? { v: T } : never',
			}),
		]),
	);
});

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

it('parses parameter defaults and docs consistently across function and class signatures', () => {
	const filePath = '/virtual/shared-signature-defaults.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, sharedSignatureDefaultsSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				parameters: [
					{
						name: 'options',
						defaultValue: 'defaultOptions',
						optional: true,
						documentation: {
							description: 'Function options.',
						},
					},
					{
						name: 'inline',
						defaultValue: '{ compact: true }',
						optional: true,
					},
				],
			},
		],
	});
	expect(moduleDefinition.exports[1]?.type).toMatchObject({
		kind: 'class',
		constructSignatures: [
			{
				parameters: [
					{
						name: 'options',
						defaultValue: 'defaultOptions',
						optional: true,
						documentation: {
							description: 'Constructor options.',
						},
					},
				],
			},
		],
		methods: [
			{
				name: 'configure',
				callSignatures: [
					{
						parameters: [
							{
								name: 'options',
								defaultValue: 'defaultOptions',
								optional: true,
								documentation: {
									description: 'Method options.',
								},
							},
							{
								name: 'inline',
								defaultValue: '{ compact: true }',
								optional: true,
							},
						],
					},
				],
			},
		],
	});
});
