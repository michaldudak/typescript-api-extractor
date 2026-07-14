import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parseFromProgram } from '../../index';
import { FunctionNode, TypeOperatorNode } from '../../models';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

function parseSerializedModule(filePath: string, program: ts.Program) {
	return JSON.parse(JSON.stringify(parseFromProgram(filePath, program)));
}

it('preserves concrete keyof operators instead of expanding them to literal unions', () => {
	const filePath = path.resolve(process.cwd(), 'virtual-keyof-react.tsx');
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`import * as React from 'react';

export interface Parameters {
  defaultTagName?: keyof React.JSX.IntrinsicElements;
}`,
					{ jsx: ts.JsxEmit.ReactJSX },
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		properties: [
			{
				name: 'defaultTagName',
				optional: true,
				type: {
					kind: 'union',
					types: [
						{
							kind: 'typeOperator',
							operator: 'keyof',
							resolutionKind: 'exact',
							type: {
								kind: 'external',
								typeName: {
									name: 'IntrinsicElements',
									namespaces: ['React', 'JSX'],
								},
							},
							resolvedType: {
								kind: 'union',
								types: expect.arrayContaining([
									{
										kind: 'literal',
										value: '"symbol"',
									},
									{
										kind: 'literal',
										value: '"object"',
									},
									{
										kind: 'literal',
										value: '"a"',
									},
								]),
							},
						},
						{
							kind: 'intrinsic',
							intrinsic: 'undefined',
						},
					],
				},
			},
		],
	});

	const typeOperatorNode = moduleDefinition.exports[0]?.type.properties[0].type.types[0];
	expect(typeOperatorNode.resolvedType.types.length).toBeGreaterThan(100);
});

it('preserves authored type-query operands without expanding their value shape', () => {
	const filePath = '/virtual/keyof-type-query.ts';
	const dependencyPath = '/virtual/keyof-type-query-dependency.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: `const value = { a: 1, b: 2 };

export type Keys = keyof typeof value;
export type ImportedKeys = keyof typeof import("./keyof-type-query-dependency");`,
			[dependencyPath]: `export const importedValue = 1;
export const importedText = 'text';`,
		}),
	);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const parsedExportByName = (name: string) =>
		parsedModule.exports.find((exportNode) => exportNode.name === name);

	expect(exportByName('Keys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'typeQuery',
			expressionName: 'value',
		},
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
	});
	expect(exportByName('ImportedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'typeQuery',
			expressionName: 'import("./keyof-type-query-dependency")',
		},
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"importedValue"' },
				{ kind: 'literal', value: '"importedText"' },
			],
		},
	});
	expect(parsedExportByName('Keys')?.type.toString()).toBe('keyof typeof value');
	expect(parsedExportByName('ImportedKeys')?.type.toString()).toBe(
		'keyof typeof import("./keyof-type-query-dependency")',
	);
});

it('preserves readonly array and tuple operands', () => {
	const filePath = '/virtual/keyof-readonly-operands.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`type ReadonlyStrings = readonly string[];
type ReadonlyPair = readonly [string, number];

export type ReadonlyArrayKeys = keyof readonly string[];
export type ReadonlyTupleKeys = keyof readonly [string, number];
export type UtilityArrayKeys = keyof Readonly<string[]>;
export type UtilityTupleKeys = keyof Readonly<[string, number]>;
export interface Box {
  values: ReadonlyStrings;
  pair: ReadonlyPair;
}`,
		),
	);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const parsedExportByName = (name: string) =>
		parsedModule.exports.find((exportNode) => exportNode.name === name);

	expect(exportByName('ReadonlyArrayKeys')?.type.type).toMatchObject({
		kind: 'array',
		isReadonly: true,
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
	});
	expect(exportByName('ReadonlyTupleKeys')?.type.type).toMatchObject({
		kind: 'tuple',
		isReadonly: true,
		types: [
			{ kind: 'intrinsic', intrinsic: 'string' },
			{ kind: 'intrinsic', intrinsic: 'number' },
		],
	});
	expect(parsedExportByName('ReadonlyArrayKeys')?.type.toString()).toBe('keyof readonly string[]');
	expect(parsedExportByName('ReadonlyTupleKeys')?.type.toString()).toBe(
		'keyof readonly [string, number]',
	);
	for (const name of ['UtilityArrayKeys', 'UtilityTupleKeys']) {
		expect(exportByName(name)?.type.type).toMatchObject({ isReadonly: true });
		expect(parsedExportByName(name)?.type.toString()).toMatch(/^keyof readonly /);
	}
	expect(exportByName('Box')?.type.properties).toMatchObject([
		{ name: 'values', type: { kind: 'array', isReadonly: true } },
		{ name: 'pair', type: { kind: 'tuple', isReadonly: true } },
	]);
	const arrayKeyValues = exportByName('ReadonlyArrayKeys')
		?.type.resolvedType.types.filter((type: { kind: string }) => type.kind === 'literal')
		.map((type: { value: string }) => type.value);
	expect(arrayKeyValues).not.toContain('"push"');
});

it('preserves keyof operators inside explicit unions', () => {
	const filePath = '/virtual/keyof-union.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export function acceptsMaybeKey(prop: keyof Params | undefined): void {}

interface Params {
  a: string;
  b: number;
}`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				parameters: [
					{
						name: 'prop',
						type: {
							kind: 'union',
							types: [
								{
									kind: 'typeOperator',
									operator: 'keyof',
									type: {
										kind: 'object',
										typeName: {
											name: 'Params',
										},
									},
									resolvedType: {
										kind: 'union',
										types: [
											{
												kind: 'literal',
												value: '"a"',
											},
											{
												kind: 'literal',
												value: '"b"',
											},
										],
									},
								},
								{
									kind: 'intrinsic',
									intrinsic: 'undefined',
								},
							],
						},
					},
				],
			},
		],
	});
});

it('preserves overlapping keyof members in either explicit-union order', () => {
	const filePath = '/virtual/keyof-overlapping-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Wide {
  a: string;
  b: number;
}

interface Narrow {
  a: string;
}

export type Forward = keyof Wide | keyof Narrow;
export type Reverse = keyof Narrow | keyof Wide;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const operatorFor = (operandName: string) => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: operandName } },
	});

	expect(exportByName('Forward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Wide'), operatorFor('Narrow')],
	});
	expect(exportByName('Reverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Narrow'), operatorFor('Wide')],
	});
});

it('keeps keyof operators with different generic operands in either union order', () => {
	const filePath = '/virtual/keyof-generic-operand-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Box<T> {
  a: T;
  b: T;
}

export type Forward = keyof Box<any> | keyof Box<string>;
export type Reverse = keyof Box<string> | keyof Box<any>;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const operatorFor = (intrinsic: 'any' | 'string') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			typeName: {
				name: 'Box',
				typeArguments: [{ type: { kind: 'intrinsic', intrinsic } }],
			},
		},
	});

	expect(exportByName('Forward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('any'), operatorFor('string')],
	});
	expect(exportByName('Reverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('string'), operatorFor('any')],
	});
});

it('preserves keyof members after union simplification and generic alias instantiation', () => {
	const filePath = '/virtual/keyof-simplified-unions.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type Collapsed = keyof {} | 'fallback';
type MaybeKeys<T> = keyof T | undefined;
export type Concrete = MaybeKeys<Params>;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('Collapsed')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'literal', value: '"fallback"' },
		],
	});
	expect(exportByName('Concrete')?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'Params' } },
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"a"' },
						{ kind: 'literal', value: '"b"' },
					],
				},
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
});

it('reconstructs checker-collapsed intersections, conditionals, and indexed access', () => {
	const filePath = '/virtual/keyof-collapsed-wrappers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Box {
  keys: keyof Params;
}

interface NestedBox {
  keys: Box['keys'];
}

interface GenericBox<T> {
  keys: keyof T;
}

type KeyAlias = keyof Params;
interface AliasBox {
  keys: KeyAlias;
}

class AccessorBox {
  get keys(): keyof Params {
    return 'a';
  }
}

type KeyTuple = [keyof Params];

export type ConcreteIntersection = keyof Params & string;
export type OptionalIntersection = (keyof Params & string) | undefined;
export type ConcreteConditional = true extends true ? keyof Params : never;
export type TrueConditionalWithAny = true extends true ? keyof Params : any;
export type FalseConditionalWithAny = false extends true ? any : keyof Params;
export type IndexedKeys = Box['keys'];
export type NestedIndexedKeys = NestedBox['keys'];
export type GenericIndexedKeys = GenericBox<Params>['keys'];
export type AliasIndexedKeys = AliasBox['keys'];
export type AccessorIndexedKeys = AccessorBox['keys'];
export type TupleIndexedKeys = KeyTuple[0];`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const expectedOperator = {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', typeName: { name: 'Params' }, properties: [] },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
		resolutionKind: 'exact',
	};

	expect(exportByName('ConcreteIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	expect(exportByName('OptionalIntersection')?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'intersection',
				types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('ConcreteConditional')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TrueConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('FalseConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('IndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('NestedIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('GenericIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('AliasIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('AccessorIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TupleIndexedKeys')?.type).toMatchObject(expectedOperator);
});

it('keeps the semantic result for distributed conditional keyof aliases', () => {
	const filePath = '/virtual/keyof-distributed-conditional.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface A {
  a: string;
  common: boolean;
}

interface B {
  b: number;
  common: boolean;
}

type Distributed<T> = T extends unknown ? keyof T : never;
export type Keys = Distributed<A | B>;`,
		),
	);
	const keys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Keys',
	)?.type;

	expect(keys).toMatchObject({ kind: 'union' });
	expect(keys.types.map((member: { value: string }) => member.value).sort()).toEqual([
		'"a"',
		'"b"',
		'"common"',
	]);
	expect(JSON.stringify(keys)).not.toContain('typeOperator');
});

it('preserves keyof through generic container aliases and declaration defaults', () => {
	const filePath = '/virtual/keyof-generic-container-aliases.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type KeyArray<T> = (keyof T)[];
type KeyTuple<T> = [keyof T];
type KeyConditional<T> = T extends object ? keyof T : never;
type KeyIntersection<T> = keyof T & string;
type MaybeKeys<T = Params, U = T> = keyof U | undefined;
type MaybePartialKeys<T = Params, U = Partial<T>> = keyof U | undefined;

export type ArrayAlias = KeyArray<Params>;
export type TupleAlias = KeyTuple<Params>;
export type ConditionalAlias = KeyConditional<Params>;
export type IntersectionAlias = KeyIntersection<Params>;
export type OmittedDefaults = MaybeKeys;
export type DependentDefault = MaybeKeys<Params>;
export type OmittedCompositeDefault = MaybePartialKeys;
export type ExplicitCompositeDefault = MaybePartialKeys<Params>;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const expectedOperator = {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params' } },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
		resolutionKind: 'exact',
	};

	expect(exportByName('ArrayAlias')?.type).toMatchObject({
		kind: 'array',
		typeName: { name: 'ArrayAlias' },
		elementType: expectedOperator,
	});
	expect(exportByName('ArrayAlias')?.type.typeName).not.toHaveProperty('typeArguments');
	expect(exportByName('TupleAlias')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator],
	});
	expect(exportByName('ConditionalAlias')?.type).toMatchObject(expectedOperator);
	expect(exportByName('IntersectionAlias')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	for (const name of ['OmittedDefaults', 'DependentDefault']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			typeName: { name },
			types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
		});
	}
	const expectedPartialOperator = {
		...expectedOperator,
		type: {
			kind: 'object',
			typeName: {
				name: 'Partial',
				typeArguments: [{ type: { typeName: { name: 'Params' } } }],
			},
		},
	};
	for (const name of ['OmittedCompositeDefault', 'ExplicitCompositeDefault']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			typeName: { name },
			types: [expectedPartialOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
		});
	}
});

it('preserves keyof constraints on signature type parameters', () => {
	const filePath = '/virtual/keyof-constraint.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export function find<T, K extends keyof T>(key: K): void {}`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				parameters: [
					{
						name: 'key',
						type: {
							kind: 'typeParameter',
							name: 'K',
							constraint: {
								kind: 'typeOperator',
								operator: 'keyof',
								resolutionKind: 'baseConstraint',
								type: {
									kind: 'typeParameter',
									name: 'T',
								},
								resolvedType: {
									kind: 'union',
									types: [
										{
											kind: 'intrinsic',
											intrinsic: 'string',
										},
										{
											kind: 'intrinsic',
											intrinsic: 'number',
										},
										{
											kind: 'intrinsic',
											intrinsic: 'symbol',
										},
									],
								},
							},
						},
					},
				],
				typeParameters: [
					{
						kind: 'typeParameter',
						name: 'T',
					},
					{
						kind: 'typeParameter',
						name: 'K',
						constraint: {
							kind: 'typeOperator',
							operator: 'keyof',
							type: {
								kind: 'typeParameter',
								name: 'T',
							},
							resolvedType: {
								kind: 'union',
								types: [
									{
										kind: 'intrinsic',
										intrinsic: 'string',
									},
									{
										kind: 'intrinsic',
										intrinsic: 'number',
									},
									{
										kind: 'intrinsic',
										intrinsic: 'symbol',
									},
								],
							},
						},
					},
				],
			},
		],
	});
});

it('resolves non-union keyof results without falling back to any', () => {
	const filePath = '/virtual/keyof-non-union-results.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export type StringKey = keyof { a: string };
export type NumericKey = keyof { 1: string };
export type EmptyKey = keyof {};
export type UnknownKey = keyof unknown;`,
				),
			),
		),
	);

	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('StringKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'literal',
			value: '"a"',
		},
	});
	expect(exportByName('NumericKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'literal',
			value: 1,
		},
	});
	expect(exportByName('EmptyKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'never',
		},
	});
	expect(exportByName('UnknownKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'intrinsic',
			intrinsic: 'unknown',
		},
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'never',
		},
	});
});

it('marks unsupported single and union result members as fallbacks', () => {
	const filePath = '/virtual/keyof-result-fallback.ts';
	const warnings: Array<{ code: string; typeFlags?: string[] }> = [];
	const program = createInMemoryProgram(
		filePath,
		`type Pattern = \`pattern-\${string}\`;
type MixedPattern = \`mixed-\${string}\`;

export type PatternKeys = keyof { [K in Pattern]: unknown };
export type MixedPatternKeys = keyof { [K in MixedPattern | 'fixed']: unknown };`,
	);
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(filePath, program, {
				onWarning: (warning) => warnings.push(warning),
			}),
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('PatternKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolutionKind: 'fallback',
		resolvedType: { kind: 'intrinsic', intrinsic: 'any' },
	});
	expect(exportByName('MixedPatternKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolutionKind: 'fallback',
		resolvedType: {
			kind: 'union',
			types: expect.arrayContaining([
				{ kind: 'intrinsic', intrinsic: 'any' },
				{ kind: 'literal', value: '"fixed"' },
			]),
		},
	});
	expect(warnings).toHaveLength(2);
	expect(warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: 'unsupported-type-fallback',
				typeFlags: expect.arrayContaining(['TemplateLiteral']),
			}),
		]),
	);
});

it('preserves undefined when an optional or explicit-union keyof result is never', () => {
	const filePath = '/virtual/keyof-never-with-undefined.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export interface Options {
  empty?: keyof {};
  unknown?: keyof unknown;
}

export type MaybeEmpty = keyof {} | undefined;
export type MaybeUnknown = undefined | keyof unknown;
export type MaybeKeys = keyof Params | undefined;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const expectedMaybeNever = {
		kind: 'union',
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				resolvedType: { kind: 'intrinsic', intrinsic: 'never' },
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	};

	expect(exportByName('Options')?.type.properties).toMatchObject([
		{ name: 'empty', optional: true, type: expectedMaybeNever },
		{ name: 'unknown', optional: true, type: expectedMaybeNever },
	]);
	expect(exportByName('MaybeEmpty')?.type).toMatchObject(expectedMaybeNever);
	expect(exportByName('MaybeUnknown')?.type).toMatchObject(expectedMaybeNever);
	expect(exportByName('MaybeKeys')?.type).toMatchObject({
		kind: 'union',
		typeName: { name: 'MaybeKeys' },
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"a"' },
						{ kind: 'literal', value: '"b"' },
					],
				},
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('MaybeKeys')?.type.types[0].resolvedType).not.toHaveProperty('typeName');
});

it('uses the instantiated result type for generic keyof operators', () => {
	const filePath = '/virtual/keyof-instantiated-generic.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`type Wrapper<T> = { keys: keyof T };

export type Concrete = Wrapper<{ a: string; b: number }>;`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		properties: [
			{
				name: 'keys',
				type: {
					kind: 'typeOperator',
					operator: 'keyof',
					type: {
						kind: 'typeParameter',
						name: 'T',
					},
					resolvedType: {
						kind: 'union',
						types: [
							{
								kind: 'literal',
								value: '"a"',
							},
							{
								kind: 'literal',
								value: '"b"',
							},
						],
					},
				},
			},
		],
	});
});

it('preserves keyof syntax before type-parameter and external semantic fallbacks', () => {
	const filePath = '/virtual/keyof-resolver-precedence.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type MappedKeys<T extends PropertyKey> = keyof { [P in T]: unknown };

declare const iterator: unique symbol;
export type SymbolKeys = keyof { [iterator]: string };`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('MappedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('SymbolKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});

it('keeps semantic result names off the operator and preserves unique-symbol identity', () => {
	const filePath = '/virtual/keyof-result-identity.ts';
	const program = createInMemoryProgram(
		filePath,
		`type Key = 'a' | 'b';
type Params = Record<Key, string>;
export type Keys = keyof Params;

declare const tag: unique symbol;
export type UniqueKey = keyof { [tag]: string };`,
	);
	const parsedModule = parseFromProgram(filePath, program);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const parsedExportByName = (name: string) =>
		parsedModule.exports.find((exportNode) => exportNode.name === name);

	expect(exportByName('Keys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'union',
			typeName: { name: 'Key' },
		},
	});
	expect((parsedExportByName('Keys')?.type as TypeOperatorNode).typeName).toBeUndefined();
	expect(parsedExportByName('Keys')?.type.toString()).toBe('keyof Params');

	expect(exportByName('UniqueKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'symbol',
			typeName: { name: 'tag' },
		},
	});
	expect((parsedExportByName('UniqueKey')?.type as TypeOperatorNode).typeName).toBeUndefined();
});

it('parenthesizes function operands when rendering keyof syntax', () => {
	const filePath = '/virtual/keyof-function-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type FunctionKeys = keyof ((value: string) => number);`,
		),
	);
	const renderedType = parsedModule.exports[0]?.type.toString();

	expect(renderedType).toBe('keyof ((value: string) => number)');
	const renderedProgram = createInMemoryProgram(
		'/virtual/rendered-type.ts',
		`type Rendered = ${renderedType};`,
	);
	expect(renderedProgram.getSyntacticDiagnostics()).toEqual([]);
});

it('parenthesizes keyof operators when rendering array element types', () => {
	const filePath = '/virtual/keyof-array-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export function acceptsKeys(keys: (keyof Params)[]): void {}`,
		),
	);
	const functionType = parsedModule.exports[0]?.type as FunctionNode;
	const renderedType = functionType.callSignatures[0].parameters[0].type.toString();

	expect(renderedType).toBe('(keyof Params)[]');
	const renderedProgram = createInMemoryProgram(
		'/virtual/rendered-array-type.ts',
		`type Rendered = ${renderedType};`,
	);
	expect(renderedProgram.getSyntacticDiagnostics()).toEqual([]);
});

it('does not expand properties that are discarded from named object operands', () => {
	const filePath = '/virtual/keyof-shallow-operand.ts';
	const objectResolutions: string[] = [];
	const includedProperties: string[] = [];
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
		),
		{
			shouldResolveObject: ({ name }) => {
				objectResolutions.push(name);
				return true;
			},
			shouldInclude: ({ name }) => {
				includedProperties.push(name);
				return true;
			},
		},
	);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));

	expect(moduleDefinition.exports[0]?.type.type).toMatchObject({
		kind: 'object',
		typeName: { name: 'Params' },
		properties: [],
	});
	expect(parsedModule.exports[0]?.type.toString()).toBe('keyof Params');
	expect(objectResolutions).toEqual([]);
	expect(includedProperties).toEqual([]);
});

it('terminates recursive keyof index-signature operands', () => {
	const filePath = '/virtual/keyof-recursive-index-signature.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`export interface Recursive {
  [key: string]: keyof Recursive;
}

export type Keys = keyof Recursive;`,
		),
	);
	const keys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Keys',
	);

	expect(keys?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'object',
			typeName: { name: 'Recursive' },
			properties: [],
		},
	});
});

it('preserves keyof syntax in index-signature and mapped-template values', () => {
	const filePath = '/virtual/keyof-index-signatures.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export interface StringDictionary {
  [name: string]: keyof Params;
}

export interface NumberDictionary {
  [index: number]: keyof Params;
}

export type MappedDictionary<K extends string> = {
  [P in K]: keyof Params;
};

export type DictionaryKeys = keyof StringDictionary;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const expectedValueType = {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', typeName: { name: 'Params' }, properties: [] },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
		resolutionKind: 'exact',
	};

	expect(exportByName('StringDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'name',
		keyType: 'string',
		valueType: expectedValueType,
	});
	expect(exportByName('NumberDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'index',
		keyType: 'number',
		valueType: expectedValueType,
	});
	expect(exportByName('MappedDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'P',
		keyType: 'string',
		valueType: expectedValueType,
	});
	expect(exportByName('DictionaryKeys')?.type.type).toMatchObject({
		kind: 'object',
		typeName: { name: 'StringDictionary' },
		properties: [],
		indexSignature: {
			keyName: 'name',
			keyType: 'string',
			valueType: expectedValueType,
		},
	});
});

it('preserves keyof aliases through named and renamed re-exports', () => {
	const sourcePath = '/virtual/keyof-reexport-source.ts';
	const entryPath = '/virtual/keyof-reexport-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
		[entryPath]: `export { type Keys, type Keys as RenamedKeys } from './keyof-reexport-source';`,
	});

	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'Keys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
		{
			name: 'RenamedKeys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
	]);
});

it('preserves keyof through concrete alias chains on re-export', () => {
	const sourcePath = '/virtual/keyof-chained-reexport-source.ts';
	const entryPath = '/virtual/keyof-chained-reexport-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}

type MaybeKeys<T> = keyof T | undefined;
export type Concrete = MaybeKeys<Params>;`,
		[entryPath]: `export { type Concrete } from './keyof-chained-reexport-source';`,
	});

	const moduleDefinition = parseSerializedModule(entryPath, program);
	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'Concrete',
		type: {
			kind: 'union',
			typeName: { name: 'Concrete' },
			types: [
				{ kind: 'typeOperator', operator: 'keyof' },
				{ kind: 'intrinsic', intrinsic: 'undefined' },
			],
		},
	});
});

it('preserves keyof aliases through local import-then-export specifiers', () => {
	const sourcePath = '/virtual/keyof-import-export-source.ts';
	const entryPath = '/virtual/keyof-import-export-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
		[entryPath]: `import type { Keys, Keys as ImportedKeys } from './keyof-import-export-source';
export type { Keys, ImportedKeys as RenamedKeys };`,
	});
	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'Keys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
		{
			name: 'RenamedKeys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
	]);
});

it('preserves keyof operators in return and container element types', () => {
	const filePath = '/virtual/keyof-nested-positions.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type KeyFactory = () => keyof Params;
export type KeyArray = (keyof Params)[];
export type GenericKeyArray = Array<keyof Params>;
export type KeyTuple = [keyof Params];
export type ReadonlyKeyArray = readonly (keyof Params)[];
export type ReadonlyKeyTuple = readonly [keyof Params];
export type NamedKeyTuple = [key?: keyof Params];
export type RestKeyTuple = [head: keyof Params, ...tail: (keyof Params)[]];`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('KeyFactory')?.type.callSignatures[0].returnValueType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('KeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('GenericKeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('KeyTuple')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('ReadonlyKeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('ReadonlyKeyTuple')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('NamedKeyTuple')?.type.types[0]).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('RestKeyTuple')?.type.types).toMatchObject([
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'typeOperator', operator: 'keyof' },
	]);
});

it('preserves keyof through referenced aliases at nested and generic boundaries', () => {
	const filePath = '/virtual/keyof-referenced-alias-boundaries.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Keys = keyof Params;
type GenericKeys<T> = keyof T;
type GenericArray<T> = Array<keyof T>;

export function returns(): Keys {
  return 'a';
}
export type KeyArray = Keys[];
export type GenericAlias<T> = GenericKeys<T>;
export type ConcreteArray = GenericArray<Params>;
export class Example {
  field!: Keys;
}
export interface Dictionary {
  [name: string]: Keys;
}`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);
	const operator = { kind: 'typeOperator', operator: 'keyof' };

	expect(exportByName('returns')?.type.callSignatures[0].returnValueType).toMatchObject(operator);
	expect(exportByName('KeyArray')?.type.elementType).toMatchObject(operator);
	expect(exportByName('GenericAlias')?.type).toMatchObject({
		...operator,
		type: { kind: 'typeParameter', name: 'T' },
		resolutionKind: 'baseConstraint',
	});
	expect(exportByName('ConcreteArray')?.type.elementType).toMatchObject({
		...operator,
		type: { typeName: { name: 'Params' } },
		resolutionKind: 'exact',
	});
	expect(exportByName('Example')?.type.properties[0].type).toMatchObject(operator);
	expect(exportByName('Dictionary')?.type.indexSignature.valueType).toMatchObject(operator);
});

it('preserves local imported keyof aliases behind a public alias', () => {
	const sourcePath = '/virtual/keyof-imported-alias-source.ts';
	const entryPath = '/virtual/keyof-imported-alias-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
		[entryPath]: `import type { Keys } from './keyof-imported-alias-source';
export type PublicKeys = Keys;`,
	});
	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'PublicKeys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		},
	});
});

it('does not treat unrelated generic array-alias arguments as element syntax', () => {
	const filePath = '/virtual/keyof-array-alias-arguments.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type AsStrings<Ignored> = string[];
type Reordered<First, Element> = Element[];

export type IgnoredArgument = AsStrings<keyof Params>;
export type ReorderedArgument = Reordered<keyof Params, number>;`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('IgnoredArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(exportByName('ReorderedArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
});

it('preserves parenthesized and union-nested keyof constraints consistently', () => {
	const filePath = '/virtual/keyof-parenthesized.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type ParenthesizedKeys = (keyof Params);
export function find<T, K extends (keyof T)>(key: K): void {}
export function findOrFallback<T, K extends keyof T | 'fallback'>(key: K): void {}`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('ParenthesizedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});

	const parenthesizedSignature = exportByName('find')?.type.callSignatures[0];
	expect(parenthesizedSignature.parameters[0].type.constraint).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(parenthesizedSignature.parameters[0].type.constraint).toEqual(
		parenthesizedSignature.typeParameters[1].constraint,
	);

	const unionSignature = exportByName('findOrFallback')?.type.callSignatures[0];
	expect(unionSignature.parameters[0].type.constraint).toEqual(
		unionSignature.typeParameters[1].constraint,
	);
	expect(unionSignature.typeParameters[1].constraint).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'literal', value: '"fallback"' },
		],
	});
});

it('preserves keyof syntax in class properties, intersections, conditionals, and defaults', () => {
	const filePath = '/virtual/keyof-additional-contexts.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export class Example {
  private accessorValue!: keyof Params;

  constructor(
    public parameterKey: keyof Params,
    public readonly optionalKey?: keyof Params,
  ) {}

  instance!: keyof Params;
  static value: keyof Params;

  get accessorKey(): keyof Params {
    return 'a';
  }

  get pairedKey(): keyof Params {
    return this.accessorValue;
  }

  set pairedKey(value: keyof Params) {
    this.accessorValue = value;
  }

  set setterKey(value: keyof Params) {}
}

export type Intersection<T> = keyof T & string;
export type NestedIntersectionLeft<T, U> = (keyof T & U) & string;
export type NestedIntersectionRight<T, U> = U & (keyof T & string);
export type Conditional<T> = T extends unknown ? keyof T : never;
export function withDefault<T = keyof Params>(value: T): void {}`,
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	const exampleProperties = exportByName('Example')?.type.properties;
	const propertyByName = (name: string) =>
		exampleProperties.find((property: { name: string }) => property.name === name);
	expect(propertyByName('parameterKey')).toMatchObject({
		type: { kind: 'typeOperator', operator: 'keyof' },
	});
	expect(propertyByName('optionalKey')).toMatchObject({
		readonly: true,
		optional: true,
		type: {
			kind: 'union',
			types: [
				{ kind: 'typeOperator', operator: 'keyof' },
				{ kind: 'intrinsic', intrinsic: 'undefined' },
			],
		},
	});
	for (const propertyName of ['instance', 'value', 'accessorKey', 'pairedKey', 'setterKey']) {
		expect(propertyByName(propertyName)).toMatchObject({
			type: { kind: 'typeOperator', operator: 'keyof' },
		});
	}
	expect(exportByName('Intersection')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('NestedIntersectionLeft')?.type.types).toMatchObject([
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'typeParameter', name: 'U' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('NestedIntersectionRight')?.type.types).toMatchObject([
		{ kind: 'typeParameter', name: 'U' },
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('Conditional')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});

	const signature = exportByName('withDefault')?.type.callSignatures[0];
	expect(signature.parameters[0].type.defaultValue).toEqual(
		signature.typeParameters[0].defaultValue,
	);
	expect(signature.typeParameters[0].defaultValue).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});
