import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const substitutionTypeSource = 'export type X<T> = T extends string ? T : never;';
const substitutionTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? T : never;';
const substitutionObjectTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? { v: T } : never;';

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

it('preserves expanded external keyof aliases in type parameter constraints and defaults', () => {
	const filePath = '/virtual/external-keyof-type-parameter-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'external-keyof-type-parameter-package';

export type Generic<T extends Keys = Keys> = T;`,
					'/virtual/node_modules/external-keyof-type-parameter-package/index.d.ts': `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);
	const typeParameter = moduleDefinition.exports[0]?.type;
	const expectedOperator = { kind: 'typeOperator', operator: 'keyof' };

	expect(typeParameter).toMatchObject({
		kind: 'typeParameter',
		name: 'T',
		constraint: expectedOperator,
		defaultValue: expectedOperator,
	});
});
