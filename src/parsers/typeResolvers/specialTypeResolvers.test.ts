import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const substitutionTypeSource = 'export type X<T> = T extends string ? T : never;';
const substitutionTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? T : never;';
const substitutionObjectTypeWithUnsupportedConstraintSource =
	'export type X<T extends `prefix-${string}`> = T extends string ? { v: T } : never;';
const extractUtilitySource = 'export type StringKeys<T> = Extract<keyof T, string>;';
const shadowedExtractSource = `type Extract<T, U> = T extends U ? T : number;
export type ShadowedExtract<T> = Extract<T, string>;`;

it('resolves the built-in Extract utility from its base constraint', () => {
	const filePath = '/virtual/extract-utility.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, extractUtilitySource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
});

it('does not treat a local Extract alias as the built-in utility', () => {
	const filePath = '/virtual/shadowed-extract.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, shadowedExtractSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeParameter',
				name: 'T',
			},
			{
				kind: 'intrinsic',
				intrinsic: 'number',
			},
		],
	});
});

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
