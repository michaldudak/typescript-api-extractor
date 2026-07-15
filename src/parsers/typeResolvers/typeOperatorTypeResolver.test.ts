import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { FunctionNode, TypeOperatorNode } from '../../models';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

function createExportLookup<TModule extends { exports: readonly { name: string }[] }>(
	moduleDefinition: TModule,
) {
	type Export = TModule['exports'][number];
	return (name: string): Export | undefined =>
		moduleDefinition.exports.find((exportNode) => exportNode.name === name) as Export | undefined;
}

function parseModuleExports(filePath: string, program: ts.Program) {
	const parsedModule = parseFromProgram(filePath, program);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));
	return {
		moduleDefinition,
		exportByName: createExportLookup(moduleDefinition),
		parsedExportByName: createExportLookup(parsedModule),
	};
}

function parseSerializedModule(filePath: string, program: ts.Program) {
	return parseModuleExports(filePath, program).moduleDefinition;
}

function expectedKeyofOperator(overrides: Record<string, unknown> = {}) {
	return {
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
		...overrides,
	};
}

const referenceFormsDependencyPath = '/virtual/keyof-reference-forms-dependency.ts';
const referenceFormsSourcePath = '/virtual/keyof-reference-forms-source.ts';
const referenceFormsEntryPath = '/virtual/keyof-reference-forms-entry.ts';
const referenceFormsDependencySource = `export interface Params {
  dependency: string;
}
export type Keys = keyof Params;`;
const referenceFormsSource = `interface LocalParams {
  local: string;
}
namespace LocalTypes {
  export type Keys = keyof LocalParams;
}

import RelativeTypes = require('./keyof-reference-forms-dependency');
import MappedTypes = require('@project/keyof-reference-forms-dependency');

export type LocalQualifiedKeys = LocalTypes.Keys;
export type ImportTypeKeys = import('./keyof-reference-forms-dependency').Keys;
export type ImportEqualsKeys = RelativeTypes.Keys;
export type PathMappedKeys = MappedTypes.Keys;`;
const referenceFormsEntrySource = `export {
  type LocalQualifiedKeys,
  type ImportTypeKeys,
  type ImportEqualsKeys,
  type PathMappedKeys,
} from './keyof-reference-forms-source';`;
const referenceFormsCompilerOptions = {
	baseUrl: '/virtual',
	paths: { '@project/*': ['*'] },
};

function expectReferenceFormExports(
	exportByName: (name: string) => { type: unknown } | undefined,
): void {
	expect(exportByName('LocalQualifiedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'LocalParams' } },
	});
	for (const name of ['ImportTypeKeys', 'ImportEqualsKeys', 'PathMappedKeys']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		});
	}
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

it('can omit checker-resolved type-operator payloads', () => {
	const filePath = '/virtual/keyof-syntax-only.ts';
	const program = createInMemoryProgram(
		filePath,
		`interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
	);
	const moduleDefinition = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'syntaxOnly',
	});
	const typeOperator = moduleDefinition.exports[0]?.type;

	expect(typeOperator).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', typeName: { name: 'Params' } },
	});
	expect(typeOperator).not.toHaveProperty('resolvedType');
	expect(typeOperator).not.toHaveProperty('resolutionKind');
});

it('keeps distinct keyof-any and keyof-string callbacks in syntax-only output', () => {
	const filePath = '/virtual/keyof-syntax-only-callbacks.ts';
	const program = createInMemoryProgram(
		filePath,
		`export type Callbacks =
  | ((key: keyof any) => void)
  | ((key: keyof string) => void);`,
	);
	const moduleDefinition = parseSerializedModule(filePath, program);
	const syntaxOnlyModuleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(filePath, program, {
				typeOperatorOutput: 'syntaxOnly',
			}),
		),
	);
	const syntaxOnlyCallbacks = syntaxOnlyModuleDefinition.exports[0]?.type.types;

	expect(moduleDefinition.exports[0]?.type.types).toHaveLength(2);
	expect(syntaxOnlyCallbacks).toHaveLength(2);
	expect(
		syntaxOnlyCallbacks.map(
			(callback: { callSignatures: Array<{ parameters: Array<{ type: { type: unknown } }> }> }) =>
				callback.callSignatures[0].parameters[0].type.type,
		),
	).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'any' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
});

it('preserves authored type-query operands without expanding their value shape', () => {
	const filePath = '/virtual/keyof-type-query.ts';
	const dependencyPath = '/virtual/keyof-type-query-dependency.ts';
	const { exportByName, parsedExportByName } = parseModuleExports(
		filePath,
		createInMemoryProgram({
			[filePath]: `const value = { a: 1, b: 2 };

export type Keys = keyof typeof value;
export type ImportedKeys = keyof typeof import("./keyof-type-query-dependency");`,
			[dependencyPath]: `export const importedValue = 1;
export const importedText = 'text';`,
		}),
	);

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
	const { exportByName, parsedExportByName } = parseModuleExports(
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
	const readonlyArrayKeys = exportByName('ReadonlyArrayKeys')?.type;
	expect(readonlyArrayKeys).toMatchObject({
		resolutionKind: 'exact',
		resolvedType: { kind: 'union' },
	});
	const arrayKeyValues = readonlyArrayKeys?.resolvedType.types
		.filter((type: { kind: string }) => type.kind === 'literal')
		.map((type: { value: string }) => type.value);
	expect(arrayKeyValues).toContain('"length"');
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

type WideKeys = keyof Wide;
type NarrowKeys = keyof Narrow;

export type Forward = keyof Wide | keyof Narrow;
export type Reverse = keyof Narrow | keyof Wide;
export type AliasedForward = WideKeys | NarrowKeys;
export type AliasedReverse = NarrowKeys | WideKeys;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (operandName: string, keys: string[]) => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: operandName } },
		resolvedType:
			keys.length === 1
				? { kind: 'literal', value: `"${keys[0]}"` }
				: {
						kind: 'union',
						types: keys.map((key) => ({ kind: 'literal', value: `"${key}"` })),
					},
		resolutionKind: 'exact',
	});

	expect(exportByName('Forward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Wide', ['a', 'b']), operatorFor('Narrow', ['a'])],
	});
	expect(exportByName('Reverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Narrow', ['a']), operatorFor('Wide', ['a', 'b'])],
	});
	expect(exportByName('AliasedForward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Wide', ['a', 'b']), operatorFor('Narrow', ['a'])],
	});
	expect(exportByName('AliasedReverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Narrow', ['a']), operatorFor('Wide', ['a', 'b'])],
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
	const exportByName = createExportLookup(moduleDefinition);
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
	const exportByName = createExportLookup(moduleDefinition);

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

interface Alpha {
  alpha: string;
}

interface Beta {
  beta: number;
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

interface AlphaBox {
  keys: keyof Alpha;
}

interface BetaBox {
  keys: keyof Beta;
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
export type AliasedIntersection = KeyAlias & string;
export type OptionalIntersection = (keyof Params & string) | undefined;
export type ConcreteConditional = true extends true ? keyof Params : never;
export type AliasedConditional = true extends true ? KeyAlias : never;
export type TrueConditionalWithAny = true extends true ? keyof Params : any;
export type FalseConditionalWithAny = false extends true ? any : keyof Params;
type Select<T extends { kind: string }> = T['kind'] extends 'a' ? keyof Alpha : keyof Beta;
export type CompositeConditional = Select<{ kind: 'a' }>;
export type IndexedKeys = Box['keys'];
export type NestedIndexedKeys = NestedBox['keys'];
export type GenericIndexedKeys = GenericBox<Params>['keys'];
export type UnionIndexedKeys = (AlphaBox | BetaBox)['keys'];
export type AliasIndexedKeys = AliasBox['keys'];
export type AccessorIndexedKeys = AccessorBox['keys'];
export type TupleIndexedKeys = KeyTuple[0];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator({
		type: { kind: 'object', typeName: { name: 'Params' }, properties: [] },
	});

	expect(exportByName('ConcreteIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	expect(exportByName('AliasedIntersection')?.type).toMatchObject({
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
	expect(exportByName('AliasedConditional')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TrueConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('FalseConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('CompositeConditional')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Alpha' } },
		resolvedType: { kind: 'literal', value: '"alpha"' },
		resolutionKind: 'exact',
	});
	expect(exportByName('IndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('NestedIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('GenericIndexedKeys')?.type).toMatchObject(expectedOperator);
	const unionIndexedKeys = exportByName('UnionIndexedKeys')?.type;
	expect(unionIndexedKeys).toMatchObject({ kind: 'union' });
	expect(unionIndexedKeys.types.map((member: { value: string }) => member.value).sort()).toEqual([
		'"alpha"',
		'"beta"',
	]);
	expect(JSON.stringify(unionIndexedKeys)).not.toContain('typeOperator');
	expect(exportByName('AliasIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('AccessorIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TupleIndexedKeys')?.type).toMatchObject(expectedOperator);
});

it('applies authored generic alias bindings to indexed-access sources', () => {
	const filePath = '/virtual/keyof-generic-alias-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type KeyTuple<T> = [keyof T];
type NestedTuple<T> = [T];
type KeyBox<T> = { keys: keyof T };
type NestedBox<T> = { keys: T };
type OuterKeyTuple<T> = KeyTuple<T>;
type OuterNestedTuple<T> = NestedTuple<T>;
type OuterKeyBox<T> = KeyBox<T>;
type OuterNestedBox<T> = NestedBox<T>;
type DeepBox<T> = { inner: { keys: T } };
type IntermediateBox<T> = { inner: NestedBox<T> };
type IntermediateKeyBox<T> = { inner: NestedBox<keyof T> };
interface InterfaceBox<T> {
  keys: T;
}
type InterfaceAlias<T> = InterfaceBox<T>;
type InterfaceKeyAlias<T> = InterfaceBox<keyof T>;

export type TupleKey = KeyTuple<Params>[0];
export type NestedTupleKey = NestedTuple<keyof Params>[0];
export type ObjectKey = KeyBox<Params>['keys'];
export type NestedObjectKey = NestedBox<keyof Params>['keys'];
export type ChainedTupleKey = OuterKeyTuple<Params>[0];
export type ChainedNestedTupleKey = OuterNestedTuple<keyof Params>[0];
export type ChainedObjectKey = OuterKeyBox<Params>['keys'];
export type ChainedNestedObjectKey = OuterNestedBox<keyof Params>['keys'];
export type DeepObjectKey = DeepBox<keyof Params>['inner']['keys'];
export type IntermediateObjectKey = IntermediateBox<keyof Params>['inner']['keys'];
export type IntermediateWrappedObjectKey = IntermediateKeyBox<Params>['inner']['keys'];
export type InterfaceAliasKey = InterfaceAlias<keyof Params>['keys'];
export type InterfaceWrappedAliasKey = InterfaceKeyAlias<Params>['keys'];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of [
		'TupleKey',
		'NestedTupleKey',
		'ObjectKey',
		'NestedObjectKey',
		'ChainedTupleKey',
		'ChainedNestedTupleKey',
		'ChainedObjectKey',
		'ChainedNestedObjectKey',
		'DeepObjectKey',
		'IntermediateObjectKey',
		'IntermediateWrappedObjectKey',
		'InterfaceAliasKey',
		'InterfaceWrappedAliasKey',
	]) {
		expect(exportByName(name)?.type).toMatchObject(expectedOperator);
	}
});

it('traces keyof through numeric array indexed access', () => {
	const filePath = '/virtual/keyof-array-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type List<T> = T[];
type ReadonlyList<T> = readonly T[];
type WrappedList<T> = Promise<T>[];

export type Direct = (keyof Params)[][number];
export type Generic = List<keyof Params>[number];
export type ReadonlyGeneric = ReadonlyList<keyof Params>[number];
export type DirectLiteral = (keyof Params)[][0];
export type GenericLiteral = List<keyof Params>[123];
export type WrappedGeneric = WrappedList<keyof Params>[number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of ['Direct', 'Generic', 'ReadonlyGeneric', 'DirectLiteral', 'GenericLiteral']) {
		expect(exportByName(name)?.type).toMatchObject(expectedOperator);
	}
	const wrappedGenericOperator =
		exportByName('WrappedGeneric')?.type.typeName.typeArguments[0].type;
	expect(wrappedGenericOperator).toMatchObject(expectedOperator);
	expect(wrappedGenericOperator?.resolvedType).not.toHaveProperty('typeName');
});

it('preserves keyof inside built-in Readonly array and tuple utilities', () => {
	const filePath = '/virtual/keyof-readonly-utility-containers.ts';
	const program = createInMemoryProgram(
		filePath,
		`interface Params {
  a: string;
  b: number;
}

type ReadonlyWrapper<T> = Readonly<T>;

export type UtilityArray = Readonly<(keyof Params)[]>;
export type UtilityArrayElement = Readonly<(keyof Params)[]>[number];
export type UtilityTuple = Readonly<[keyof Params]>;
export type UtilityTupleElement = Readonly<[keyof Params]>[number];
export type WrappedArray = ReadonlyWrapper<(keyof Params)[]>;
export type WrappedArrayElement = ReadonlyWrapper<(keyof Params)[]>[number];
export type WrappedTuple = ReadonlyWrapper<[keyof Params]>;
export type WrappedTupleElement = ReadonlyWrapper<[keyof Params]>[number];`,
	);
	const expectedOperator = expectedKeyofOperator();

	for (const includeExternalTypes of [false, true]) {
		const moduleDefinition = JSON.parse(
			JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })),
		);
		const exportByName = createExportLookup(moduleDefinition);
		for (const name of ['UtilityArray', 'WrappedArray']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject({
				kind: 'array',
				isReadonly: true,
				elementType: expectedOperator,
			});
		}
		for (const name of ['UtilityArrayElement', 'WrappedArrayElement']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject(
				expectedOperator,
			);
		}
		for (const name of ['UtilityTuple', 'WrappedTuple']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject({
				kind: 'tuple',
				isReadonly: true,
				types: [expectedOperator],
			});
		}
		for (const name of ['UtilityTupleElement', 'WrappedTupleElement']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject(
				expectedOperator,
			);
		}
	}
});

it('reconstructs fixed tuple members selected by a number index', () => {
	const filePath = '/virtual/keyof-tuple-number-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Pair<Value> = [Value];
type Mixed<Value> = [Value, number];
type WrappedPair<Value> = [Promise<Value>];
type WrappedMixed<Value> = [Promise<Value>, number];

export type Single = [keyof Params][number];
export type GenericSingle = Pair<keyof Params>[number];
export type Multiple = [keyof Params, number][number];
export type GenericMultiple = Mixed<keyof Params>[number];
export type WrappedSingle = WrappedPair<keyof Params>[number];
export type WrappedMultiple = WrappedMixed<keyof Params>[number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Single')?.type).toMatchObject(expectedOperator);
	expect(exportByName('GenericSingle')?.type).toMatchObject(expectedOperator);
	for (const name of ['Multiple', 'GenericMultiple']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'number' }],
		});
	}
	const wrappedSingleOperator = exportByName('WrappedSingle')?.type.typeName.typeArguments[0].type;
	expect(wrappedSingleOperator).toMatchObject(expectedOperator);
	expect(wrappedSingleOperator?.resolvedType).not.toHaveProperty('typeName');
	const wrappedMultipleOperator =
		exportByName('WrappedMultiple')?.type.types[0].typeName.typeArguments[0].type;
	expect(wrappedMultipleOperator).toMatchObject(expectedOperator);
	expect(wrappedMultipleOperator?.resolvedType).not.toHaveProperty('typeName');
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

it('keeps never for distributed conditional aliases instantiated with never', () => {
	const filePath = '/virtual/keyof-distributed-conditional-never.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type SelectKeys<T> = T extends string ? keyof { a: 1 } : keyof { b: 1 };

export type Result = SelectKeys<never>;`,
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'never',
	});
});

it('matches conditional branches after substituting ordinary branch parameters', () => {
	const filePath = '/virtual/keyof-conditional-branch-substitution.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type Select<T, U> = [T] extends [string] ? U : keyof { n: 1 };
type SelectTrueKeyof<T, U> = [T] extends [string] ? keyof { n: 1 } : U;
type SelectFalseKeyof<T, U> = [T] extends [string] ? U : keyof { n: 1 };
type SelectNested<T> = [Promise<T>] extends [Promise<string>]
  ? keyof { nestedTrue: 1 }
  : keyof { nestedFalse: 1 };
type SelectArray<T> = [T[]] extends [string[]]
  ? keyof { arrayTrue: 1 }
  : keyof { arrayFalse: 1 };

export type Result = Select<string, 'x'>;
export type IndistinguishableBranches = Select<string, 'n'>;
export type TrueKeyof = SelectTrueKeyof<string, 'n'>;
export type FalseKeyof = SelectFalseKeyof<number, 'n'>;
export type NestedTrueKeyof = SelectNested<string>;
export type ArrayTrueKeyof = SelectArray<string>;`,
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'literal',
		value: '"x"',
	});
	expect(moduleDefinition.exports[1]?.type).toMatchObject({
		kind: 'literal',
		value: '"n"',
	});
	expect(moduleDefinition.exports[2]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(moduleDefinition.exports[3]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(moduleDefinition.exports[4]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', properties: [{ name: 'nestedTrue' }] },
		resolvedType: { kind: 'literal', value: '"nestedTrue"' },
	});
	expect(moduleDefinition.exports[5]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', properties: [{ name: 'arrayTrue' }] },
		resolvedType: { kind: 'literal', value: '"arrayTrue"' },
	});
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
type CompositeKeyDefault<T, U = Record<keyof T, string>> = keyof U;

export type ArrayAlias = KeyArray<Params>;
export type TupleAlias = KeyTuple<Params>;
export type ConditionalAlias = KeyConditional<Params>;
export type IntersectionAlias = KeyIntersection<Params>;
export type OmittedDefaults = MaybeKeys;
export type DependentDefault = MaybeKeys<Params>;
export type OmittedCompositeDefault = MaybePartialKeys;
export type ExplicitCompositeDefault = MaybePartialKeys<Params>;
export type NestedCompositeDefault = CompositeKeyDefault<Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

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
	expect(exportByName('NestedCompositeDefault')?.type).toMatchObject({
		...expectedOperator,
		type: {
			kind: 'external',
			typeName: {
				name: 'Record',
				typeArguments: [
					{ type: expectedOperator },
					{ type: { kind: 'intrinsic', intrinsic: 'string' } },
				],
			},
		},
	});
});

it('preserves keyof mapped-value syntax after mapped type instantiation', () => {
	const filePath = '/virtual/keyof-instantiated-mapped-values.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Mapped<K extends string> = {
  [Key in K]: keyof Params;
};

type ValueDictionary<Value> = {
  [name in string]: Value;
};

export type Dictionary = Mapped<string>;
export type Finite = Mapped<'value'>;
export type GenericDictionary = ValueDictionary<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Dictionary')?.type.indexSignature).toMatchObject({
		keyName: 'Key',
		keyType: 'string',
		valueType: expectedOperator,
	});
	expect(exportByName('Finite')?.type.properties).toMatchObject([
		{ name: 'value', type: expectedOperator },
	]);
	expect(exportByName('GenericDictionary')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
});

it('preserves authored keyof arguments through identity and container aliases', () => {
	const filePath = '/virtual/keyof-generic-argument-syntax.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Identity<T> = T;
type Vector<T> = T[];
type Pair<T> = [T, T];
type Rest<T> = [head: T, ...tail: T[]];

export type Keys = Identity<keyof Params>;
export type KeyVector = Vector<keyof Params>;
export type KeyPair = Pair<keyof Params>;
export type KeyRest = Rest<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Keys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('KeyVector')?.type).toMatchObject({
		kind: 'array',
		elementType: expectedOperator,
	});
	expect(exportByName('KeyVector')?.type.typeName).not.toHaveProperty('typeArguments');
	expect(exportByName('KeyPair')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator, expectedOperator],
	});
	expect(exportByName('KeyRest')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator, expectedOperator],
	});
});

it('preserves authored keyof arguments in object, callable, and compound members', () => {
	const filePath = '/virtual/keyof-generic-member-syntax.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Box<T> = { value: T };
type Callback<T> = (value: T) => T;
type MaybeList<T> = (T | undefined)[];

export type Boxed = Box<keyof Params>;
export type Callable = Callback<keyof Params>;
export type List = MaybeList<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Boxed')?.type.properties[0].type).toMatchObject(expectedOperator);
	const signature = exportByName('Callable')?.type.callSignatures[0];
	expect(signature.parameters[0].type).toMatchObject(expectedOperator);
	expect(signature.returnValueType).toMatchObject(expectedOperator);
	expect(exportByName('List')?.type.elementType).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
	});
});

it('matches fixed keyof syntax after an expanded variadic tuple element', () => {
	const filePath = '/virtual/keyof-variadic-tuple.ts';
	const pairPath = '/virtual/keyof-variadic-pair.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `import type { ImportedPair } from './keyof-variadic-pair';

interface Params {
  a: string;
  b: number;
}

interface OtherParams {
  c: string;
  d: number;
}

type AppendKeys<T extends unknown[]> = [...T, keyof Params];
type Spread<T extends unknown[]> = [...T];
type DoubleSpread<T extends unknown[], U extends unknown[]> = [...T, ...U];
type Combined<T extends unknown[], U extends unknown[]> = [...T, ...U];
type Identity<T> = T;
type OpenThenFiniteSpread<T extends unknown[]> = [...T, ...[keyof Params, string]];
type Pair = [keyof Params, string];
type PairAlias = Pair;
type GenericPair<T> = [keyof T, string];

export type Result = AppendKeys<[string, number]>;
export type SpreadResult = Spread<[keyof Params, string]>;
export type NamedSpreadResult = Spread<Pair>;
export type AliasedNamedSpreadResult = Spread<PairAlias>;
export type GenericNamedSpreadResult = Spread<GenericPair<Params>>;
export type ImportedNamedSpreadResult = Spread<ImportedPair<Params>>;
export type DoubleSpreadResult = DoubleSpread<
  [keyof Params, number],
  [string, keyof OtherParams]
>;
export type NestedSpreadResult = Spread<Combined<[string], [keyof Params, number]>>;
export type RepeatedAliasTuple = [Identity<string>, Identity<keyof Params>];
export type OpenThenFiniteSpreadResult<T extends unknown[]> = OpenThenFiniteSpread<T>;
export type Middle = Result[1];
export type Last = Result[2];`,
			[pairPath]: `export type ImportedPair<T> = [keyof T, string];`,
		}),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Result')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		{ kind: 'intrinsic', intrinsic: 'number' },
		expectedOperator,
	]);
	expect(exportByName('SpreadResult')?.type.types).toMatchObject([
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	for (const name of [
		'NamedSpreadResult',
		'AliasedNamedSpreadResult',
		'GenericNamedSpreadResult',
		'ImportedNamedSpreadResult',
	]) {
		const elements = exportByName(name)?.type.types;
		expect(elements).toMatchObject([expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }]);
		expect(elements[0]).not.toHaveProperty('typeName');
		expect(elements[1]).not.toHaveProperty('typeName');
	}
	expect(exportByName('DoubleSpreadResult')?.type.types).toMatchObject([
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'number' },
		{ kind: 'intrinsic', intrinsic: 'string' },
		{
			...expectedOperator,
			type: { typeName: { name: 'OtherParams' } },
			resolvedType: {
				kind: 'union',
				types: [
					{ kind: 'literal', value: '"c"' },
					{ kind: 'literal', value: '"d"' },
				],
			},
		},
	]);
	expect(exportByName('NestedSpreadResult')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'number' },
	]);
	expect(exportByName('RepeatedAliasTuple')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		expectedOperator,
	]);
	expect(exportByName('OpenThenFiniteSpreadResult')?.type.types).toMatchObject([
		{ kind: 'typeParameter', name: 'T' },
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('Middle')?.type).toEqual({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
	expect(exportByName('Last')?.type).toMatchObject(expectedOperator);
});

it('distinguishes repeated finite tuple alias instantiations from cycles', () => {
	const filePath = '/virtual/keyof-repeated-tuple-alias.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Spread<T extends unknown[]> = [...T];

export type Result = Spread<Spread<Spread<[keyof Params]>>>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('Result')?.type.types).toMatchObject([expectedKeyofOperator()]);
});

it('preserves keyof through nested generic wrapper arguments', () => {
	const filePath = '/virtual/keyof-nested-generic-wrappers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Box<T> = { value: T };
type Wrap<T> = [Box<T>];
type NestedPromise<T> = Array<Promise<T>>;

export type Direct = [Promise<keyof Params>];
export type Wrapped = Wrap<keyof Params>;
export type Promised = NestedPromise<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Direct')?.type.types[0].typeName.typeArguments[0].type).toMatchObject(
		expectedOperator,
	);
	expect(exportByName('Wrapped')?.type.types[0].properties[0].type).toMatchObject(expectedOperator);
	expect(exportByName('Promised')?.type.elementType.typeName.typeArguments[0].type).toMatchObject(
		expectedOperator,
	);
});

it('preserves keyof arguments through concrete aliases and named re-exports', () => {
	const keysPath = '/virtual/keyof-generic-argument-keys.ts';
	const sourcePath = '/virtual/keyof-generic-argument-source.ts';
	const entryPath = '/virtual/keyof-generic-argument-entry.ts';
	const program = createInMemoryProgram({
		[keysPath]: `export interface ImportedParams {
  imported: string;
}
export type ImportedKeys = keyof ImportedParams;
export interface ImportedBox<T> {
  value: T;
}`,
		[sourcePath]: `import type {
  ImportedBox,
  ImportedKeys,
} from './keyof-generic-argument-keys';

interface Params {
  a: string;
  b: number;
}

type Keys = keyof Params;
type Box<T> = { value: T };
interface InterfaceBox<T> {
  value: T;
}
type Wrapped = Box<keyof Params>;
type AliasWrapped = Box<Keys>;
type ImportedWrapped = Box<ImportedKeys>;
type InterfaceWrapped = InterfaceBox<keyof Params>;
type InterfaceAliasWrapped = InterfaceBox<Keys>;
type ImportedInterfaceWrapped = ImportedBox<ImportedKeys>;

export type Public = Wrapped;
export type AliasPublic = AliasWrapped;
export type ImportedPublic = ImportedWrapped;
export type InterfacePublic = InterfaceWrapped;
export type InterfaceAliasPublic = InterfaceAliasWrapped;
export type ImportedInterfacePublic = ImportedInterfaceWrapped;`,
		[entryPath]: `export {
  type Public,
  type AliasPublic,
  type ImportedPublic,
  type InterfacePublic,
  type InterfaceAliasPublic,
  type ImportedInterfacePublic,
} from './keyof-generic-argument-source';`,
	});

	for (const moduleDefinition of [
		parseSerializedModule(sourcePath, program),
		parseSerializedModule(entryPath, program),
	]) {
		for (const name of [
			'Public',
			'AliasPublic',
			'ImportedPublic',
			'InterfacePublic',
			'InterfaceAliasPublic',
			'ImportedInterfacePublic',
		]) {
			const exported = moduleDefinition.exports.find(
				(exportNode: { name: string }) => exportNode.name === name,
			);
			expect(exported?.type.properties[0], name).toMatchObject({
				name: 'value',
				type: { kind: 'typeOperator', operator: 'keyof' },
			});
		}
	}
});

it('preserves nested generic keyof arguments in returns and class properties', () => {
	const filePath = '/virtual/keyof-generic-boundaries.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Box<T> {
  value: T;
}

export function getBox(): Box<keyof Params> {
  throw new Error();
}

export class Example {
  value!: Box<keyof Params>;

  getBox(): Box<keyof Params> {
    throw new Error();
  }
}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();
	const boxArgument = (type: { typeName: { typeArguments: Array<{ type: unknown }> } }) =>
		type.typeName.typeArguments[0]?.type;

	const functionReturn = exportByName('getBox')?.type.callSignatures[0].returnValueType;
	expect(boxArgument(functionReturn)).toMatchObject(expectedOperator);

	const exampleType = exportByName('Example')?.type;
	const propertyType = exampleType.properties.find(
		(property: { name: string }) => property.name === 'value',
	)?.type;
	expect(boxArgument(propertyType)).toMatchObject(expectedOperator);
	const methodReturn = exampleType.methods.find(
		(method: { name: string }) => method.name === 'getBox',
	)?.callSignatures[0].returnValueType;
	expect(boxArgument(methodReturn)).toMatchObject(expectedOperator);
});

it('carries generic keyof bindings through object aliases and callable interfaces', () => {
	const filePath = '/virtual/keyof-generic-object-callable-aliases.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Box<T> {
  value: T;
  getValue(): T;
}
type BoxAlias<T> = Box<T>;
type ReorderedBoxAlias<Ignored, Value> = Box<Value>;

interface Callback<T> {
  (value: T): T;
}
type CallbackAlias<T> = Callback<T>;

export type ObjectDirect = Box<keyof Params>;
export type ObjectAliased = BoxAlias<keyof Params>;
export type ObjectSelectedKey = ReorderedBoxAlias<string, keyof Params>;
export type ObjectIgnoredKey = ReorderedBoxAlias<keyof Params, string>;
export type CallableDirect = Callback<keyof Params>;
export type CallableAliased = CallbackAlias<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of ['ObjectDirect', 'ObjectAliased', 'ObjectSelectedKey']) {
		const objectType = exportByName(name)?.type;
		expect(
			objectType.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const methodSignature = objectType.properties.find(
			(property: { name: string }) => property.name === 'getValue',
		)?.type.callSignatures[0];
		expect(methodSignature.returnValueType, name).toMatchObject(expectedOperator);
	}
	expect(exportByName('ObjectIgnoredKey')?.type.properties[0].type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});

	for (const name of ['CallableDirect', 'CallableAliased']) {
		const signature = exportByName(name)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
});

it('carries generic keyof bindings through interface and class heritage', () => {
	const filePath = '/virtual/keyof-generic-heritage.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Base<T> {
  value: T;
  method(value: T): T;
}
interface Middle<U> extends Base<U> {}
type ReorderedBase<Ignored, Value> = Base<Value>;

interface CallableBase<T> {
  (value: T): T;
}
interface CallableMiddle<U> extends CallableBase<U> {}
interface Left<T> {
  left: T;
}
interface Right<T> {
  right: T;
}

export interface DirectInterface extends Base<keyof Params> {}
export interface DeepInterface extends Middle<keyof Params> {}
export interface ReorderedInterface extends ReorderedBase<string, keyof Params> {}
export interface IgnoredInterface extends ReorderedBase<keyof Params, string> {}
export type DeepObjectAlias = Middle<keyof Params>;
export interface DirectCallable extends CallableBase<keyof Params> {}
export type DeepCallableAlias = CallableMiddle<keyof Params>;
export interface MultipleBases extends Left<keyof Params>, Right<keyof Params> {}

class BaseClass<T> {
  value!: T;
  method(value: T): T {
    return value;
  }
}
class MiddleClass<U> extends BaseClass<U> {}

export class DirectClass extends BaseClass<keyof Params> {}
export class DeepClass extends MiddleClass<keyof Params> {}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of [
		'DirectInterface',
		'DeepInterface',
		'ReorderedInterface',
		'DeepObjectAlias',
	]) {
		const type = exportByName(name)?.type;
		expect(
			type.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const signature = type.properties.find(
			(property: { name: string }) => property.name === 'method',
		)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
	expect(exportByName('IgnoredInterface')?.type.properties[0].type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});

	for (const name of ['DirectClass', 'DeepClass']) {
		const type = exportByName(name)?.type;
		expect(
			type.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const signature = type.methods.find((method: { name: string }) => method.name === 'method')
			?.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}

	for (const name of ['DirectCallable', 'DeepCallableAlias']) {
		const signature = exportByName(name)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
	const multipleBaseProperties = exportByName('MultipleBases')?.type.properties ?? [];
	expect(multipleBaseProperties.map((property: { name: string }) => property.name)).toEqual([
		'left',
		'right',
	]);
	for (const property of multipleBaseProperties) {
		expect(property.type, property.name).toMatchObject(expectedOperator);
	}
});

it('applies external expansion policy while collecting heritage bindings', () => {
	const filePath = '/virtual/keyof-external-generic-heritage.ts';
	const program = createInMemoryProgram({
		[filePath]: `import { ExternalBase, ExternalClass } from 'heritage-package';

interface Params {
  a: string;
  b: number;
}

export interface DerivedInterface extends ExternalBase<keyof Params> {}
export class DerivedClass extends ExternalClass<keyof Params> {}`,
		'/virtual/node_modules/heritage-package/index.d.ts': `export interface ExternalBase<T> {
  value: T;
}

export declare class ExternalClass<T> {
  value: T;
}`,
	});
	const parse = (includeExternalTypes: boolean) =>
		JSON.parse(JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })));
	const opaqueExportByName = createExportLookup(parse(false));
	const expandedExportByName = createExportLookup(parse(true));

	expect(opaqueExportByName('DerivedInterface')?.type.properties).toEqual([]);
	const opaqueClassProperty = opaqueExportByName('DerivedClass')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	)?.type;
	expect(opaqueClassProperty).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'literal', value: '"a"' },
			{ kind: 'literal', value: '"b"' },
		],
	});
	expect(opaqueClassProperty).not.toHaveProperty('operator');

	for (const name of ['DerivedInterface', 'DerivedClass']) {
		const property = expandedExportByName(name)?.type.properties.find(
			(candidate: { name: string }) => candidate.name === 'value',
		);
		expect(property?.type, name).toMatchObject(expectedKeyofOperator());
	}
});

it('preserves external keyof aliases in class properties when expansion is enabled', () => {
	const filePath = '/virtual/external-keyof-class-property.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'class-keyof-package';

export class Example {
  value!: Keys;
}`,
					'/virtual/node_modules/class-keyof-package/index.d.ts': `export interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);
	const propertyType = moduleDefinition.exports[0]?.type.properties[0]?.type;

	expect(propertyType).toMatchObject(expectedKeyofOperator());
});

it('replays keyof aliases that semantically collapse to any or unknown', () => {
	const filePath = '/virtual/keyof-top-type-aliases.ts';
	const warnings: ParserWarning[] = [];
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`interface Params {
  a: string;
}

interface Pattern {
  [key: \`data-\${string}\`]: number;
}

type UnknownKeys = keyof Params | unknown;
type AnyKeys = keyof Params | any;
type PatternKeys = keyof Pattern;

export type UnknownResult = UnknownKeys;
export type AnyResult = AnyKeys;
export type PatternResult = PatternKeys;`,
				),
				{
					onWarning: (warning) => {
						warnings.push(warning);
					},
				},
			),
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator({
		resolvedType: { kind: 'literal', value: '"a"' },
	});

	expect(exportByName('UnknownResult')?.type).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'unknown' }],
	});
	expect(exportByName('AnyResult')?.type).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'any' }],
	});
	expect(exportByName('PatternResult')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Pattern' } },
		resolvedType: { kind: 'intrinsic', intrinsic: 'any' },
		resolutionKind: 'fallback',
	});
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toEqual({
		code: 'unsupported-type-fallback',
		message:
			'Type extraction warning: Unable to handle type "`data-${string}`" with flag "TemplateLiteral" while resolving "keyof Pattern" at "/virtual/keyof-top-type-aliases.ts:11:20". Using any instead.',
		filePath,
		line: 11,
		column: 20,
		parsedSymbolStack: [filePath, 'PatternResult'],
		typeFlags: ['TemplateLiteral'],
		typeText: '`data-${string}`',
		sourceText: 'keyof Pattern',
	});
});

it('does not substitute a nested type parameter that shadows an alias parameter', () => {
	const filePath = '/virtual/keyof-generic-argument-shadowing.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  outer: string;
}

type Shadowed<T> = [T, <T extends { inner: string }>() => T];

export type Result = Shadowed<keyof Params>;`,
		),
	);
	const result = moduleDefinition.exports[0]?.type;

	expect(result.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params' } },
		resolvedType: { kind: 'literal', value: '"outer"' },
	});
	expect(result.types[1].callSignatures[0]).toMatchObject({
		returnValueType: {
			kind: 'typeParameter',
			name: 'T',
			constraint: {
				kind: 'object',
				properties: [{ name: 'inner' }],
			},
		},
		typeParameters: [
			{
				kind: 'typeParameter',
				name: 'T',
				constraint: {
					kind: 'object',
					properties: [{ name: 'inner' }],
				},
			},
		],
	});
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

	const exportByName = createExportLookup(moduleDefinition);

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
	const warnings: ParserWarning[] = [];
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
	const exportByName = createExportLookup(moduleDefinition);

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
	expect(warnings).toMatchObject([
		{
			code: 'unsupported-type-fallback',
			filePath,
			line: 4,
			column: 27,
			parsedSymbolStack: [filePath, 'PatternKeys'],
			typeFlags: ['TemplateLiteral'],
			typeText: '`pattern-${string}`',
			sourceText: 'keyof { [K in Pattern]: unknown }',
		},
		{
			code: 'unsupported-type-fallback',
			filePath,
			line: 5,
			column: 32,
			parsedSymbolStack: [filePath, 'MixedPatternKeys'],
			typeFlags: ['TemplateLiteral'],
			typeText: '`mixed-${string}`',
			sourceText: "keyof { [K in MixedPattern | 'fixed']: unknown }",
		},
	]);
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
	const exportByName = createExportLookup(moduleDefinition);
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

it('preserves an aliased never keyof member in a surviving union', () => {
	const filePath = '/virtual/keyof-aliased-never-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type EmptyKeys = keyof {};

export type AliasUnion = EmptyKeys | 'a' | 'b';
export type DirectUnion = keyof {} | 'a' | 'b';`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedTypes = [
		{
			kind: 'typeOperator',
			operator: 'keyof',
			resolvedType: { kind: 'intrinsic', intrinsic: 'never' },
			resolutionKind: 'exact',
		},
		{ kind: 'literal', value: '"a"' },
		{ kind: 'literal', value: '"b"' },
	];

	expect(exportByName('AliasUnion')?.type).toMatchObject({
		kind: 'union',
		types: expectedTypes,
	});
	expect(exportByName('DirectUnion')?.type).toMatchObject({
		kind: 'union',
		types: expectedTypes,
	});
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
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('MappedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('SymbolKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});

it('does not trace external indexed-access syntax unless expansion is enabled', () => {
	const filePath = '/virtual/keyof-external-indexed-access.ts';
	const files = {
		[filePath]: `export type Result = import('external-indexed-package').Pair[0];`,
		'/virtual/node_modules/external-indexed-package/index.d.ts': `interface Params {
  a: string;
  b: number;
}

export type Pair = [keyof Params];`,
	};
	const parseWithExternalPolicy = (includeExternalTypes: boolean) =>
		JSON.parse(
			JSON.stringify(
				parseFromProgram(filePath, createInMemoryProgram(files), { includeExternalTypes }),
			),
		);

	expect(createExportLookup(parseWithExternalPolicy(false))('Result')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'literal', value: '"a"' },
			{ kind: 'literal', value: '"b"' },
		],
	});
	expect(createExportLookup(parseWithExternalPolicy(true))('Result')?.type).toMatchObject(
		expectedKeyofOperator(),
	);
});

it('keeps third-party keyof re-exports external unless expansion is enabled', () => {
	const filePath = '/virtual/keyof-external-reexport.ts';
	const packagePath = '/virtual/node_modules/keyof-package/index.d.ts';
	const files = {
		[filePath]: `export {
  type Keys,
  type OuterKeys,
  type WrappedArray,
  type WrappedTuple,
  type WrappedUnion,
  type Keys as RenamedKeys,
} from 'keyof-package';`,
		[packagePath]: `export interface Params {
  external: string;
}
export type Keys = keyof Params;
export type OuterKeys = Keys;
export type WrappedArray = OuterKeys[];
export type WrappedTuple = [OuterKeys];
export type WrappedUnion = OuterKeys | null;`,
	};
	const program = createInMemoryProgram(files);
	const parseWithExternalPolicy = (includeExternalTypes?: boolean) =>
		JSON.parse(JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })));
	const expectExternalAliases = (moduleDefinition: {
		exports: { name: string; type: unknown; reexportedFrom?: string }[];
	}) => {
		for (const name of ['Keys', 'OuterKeys', 'WrappedArray', 'WrappedTuple', 'WrappedUnion']) {
			expect(
				moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name),
			).toMatchObject({
				name,
				type: { kind: 'external', typeName: { name } },
			});
		}
		expect(
			moduleDefinition.exports.find(
				(exportNode: { name: string }) => exportNode.name === 'RenamedKeys',
			),
		).toMatchObject({
			name: 'RenamedKeys',
			reexportedFrom: 'Keys',
			type: { kind: 'external', typeName: { name: 'Keys' } },
		});
	};

	expectExternalAliases(parseWithExternalPolicy(false));
	const expandedModule = parseWithExternalPolicy(true);
	const expandedExportByName = createExportLookup(expandedModule);
	const operator = { kind: 'typeOperator', operator: 'keyof' };
	expect(expandedExportByName('Keys')?.type).toMatchObject(operator);
	expect(expandedExportByName('RenamedKeys')).toMatchObject({
		reexportedFrom: 'Keys',
		type: operator,
	});
	expect(expandedExportByName('OuterKeys')?.type).toMatchObject(operator);
	expect(expandedExportByName('WrappedArray')?.type).toMatchObject({
		kind: 'array',
		elementType: operator,
	});
	expect(expandedExportByName('WrappedTuple')?.type).toMatchObject({
		kind: 'tuple',
		types: [operator],
	});
	expect(expandedExportByName('WrappedUnion')?.type).toMatchObject({
		kind: 'union',
		types: [operator, { kind: 'intrinsic', intrinsic: 'null' }],
	});
	expectExternalAliases(parseWithExternalPolicy(false));
});

it('preserves expanded external keyof aliases in parameters, returns, and index values', () => {
	const filePath = '/virtual/external-keyof-signature-consumer.ts';
	const program = createInMemoryProgram({
		[filePath]: `import type { Keys } from 'external-keyof-signatures';

export function select(value: Keys): Keys {
  return value;
}

export interface Values {
  [name: string]: Keys;
}

export type MappedValues = {
  [name in string]: Keys;
};

type Dictionary<Value> = {
  [name in string]: Value;
};

export type GenericMappedValues = Dictionary<Keys>;`,
		'/virtual/node_modules/external-keyof-signatures/index.d.ts': `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
	});
	const moduleDefinition = JSON.parse(
		JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes: true })),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = { kind: 'typeOperator', operator: 'keyof' };
	const signature = exportByName('select')?.type.callSignatures[0];

	expect(signature.parameters[0].type).toMatchObject(expectedOperator);
	expect(signature.returnValueType).toMatchObject(expectedOperator);
	expect(exportByName('Values')?.type.indexSignature.valueType).toMatchObject(expectedOperator);
	expect(exportByName('MappedValues')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
	expect(exportByName('GenericMappedValues')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
});

it('preserves expanded external keyof aliases in intersection members', () => {
	const filePath = '/virtual/external-keyof-intersection-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'external-keyof-intersection-package';

export type Narrow<T> = Keys<T> & string;`,
					'/virtual/node_modules/external-keyof-intersection-package/index.d.ts':
						'export type Keys<T> = keyof T;',
				}),
				{ includeExternalTypes: true },
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intersection',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'intrinsic', intrinsic: 'string' },
		],
	});
});

it('replays renamed keyof aliases from similarly named project directories', () => {
	const filePath = '/virtual/similar-node-modules-entry.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: "export { type Keys as RenamedKeys } from './my_node_modules/pkg';",
					'/virtual/my_node_modules/pkg.ts': `interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'RenamedKeys',
		reexportedFrom: 'Keys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		},
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
	const { exportByName, parsedExportByName } = parseModuleExports(filePath, program);

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

it('parenthesizes function types when rendering array elements', () => {
	const filePath = '/virtual/keyof-function-array-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type MutableKeys = keyof (() => void)[];
export type ReadonlyKeys = keyof readonly (() => void)[];`,
		),
	);
	const exportByName = createExportLookup(parsedModule);

	expect(exportByName('MutableKeys')?.type.toString()).toBe('keyof (() => void)[]');
	expect(exportByName('ReadonlyKeys')?.type.toString()).toBe('keyof readonly (() => void)[]');
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

it('preserves readonly metadata in recursive array and tuple operands', () => {
	const filePath = '/virtual/keyof-recursive-readonly-containers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type RecursiveArray = readonly RecursiveArray[];
type RecursiveTuple = readonly [RecursiveTuple];

export type ArrayKeys = keyof RecursiveArray;
export type TupleKeys = keyof RecursiveTuple;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('ArrayKeys')?.type.type).toMatchObject({
		kind: 'array',
		isReadonly: true,
		elementType: { kind: 'array', isReadonly: true },
	});
	expect(exportByName('TupleKeys')?.type.type).toMatchObject({
		kind: 'tuple',
		isReadonly: true,
		types: [{ kind: 'tuple', isReadonly: true }],
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
	const exportByName = createExportLookup(moduleDefinition);
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
		[sourcePath]: `export interface AlphaParams {
  alpha: string;
}

export interface BetaParams {
  beta: string;
  shared: boolean;
}

export type AlphaKeys = keyof AlphaParams;
export type BetaKeys = keyof BetaParams;`,
		[entryPath]: `export { type AlphaKeys, type BetaKeys as RenamedBetaKeys } from './keyof-reexport-source';`,
	});

	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'AlphaKeys',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'AlphaParams' } },
				resolvedType: { kind: 'literal', value: '"alpha"' },
				resolutionKind: 'exact',
			},
		},
		{
			name: 'RenamedBetaKeys',
			reexportedFrom: 'BetaKeys',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'BetaParams' } },
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"beta"' },
						{ kind: 'literal', value: '"shared"' },
					],
				},
				resolutionKind: 'exact',
			},
		},
	]);
	expect(moduleDefinition.exports[0]).not.toHaveProperty('reexportedFrom');
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

it('preserves imported keyof alias chains through named barrel re-exports', () => {
	const dependencyPath = '/virtual/keyof-barrel-dependency.ts';
	const sourcePath = '/virtual/keyof-barrel-source.ts';
	const barrelPath = '/virtual/keyof-barrel-entry.ts';
	const program = createInMemoryProgram({
		[dependencyPath]: `export interface Params {
  alpha: string;
}
export type Keys = keyof Params;`,
		[sourcePath]: `import type { Keys } from './keyof-barrel-dependency';
export type PublicKeys = Keys;`,
		[barrelPath]: `export { type PublicKeys } from './keyof-barrel-source';`,
	});
	const moduleDefinition = parseSerializedModule(barrelPath, program);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'PublicKeys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
			resolvedType: { kind: 'literal', value: '"alpha"' },
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
	const exportByName = createExportLookup(moduleDefinition);

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
	const exportByName = createExportLookup(moduleDefinition);
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

it('preserves qualified and project-mapped keyof alias references', () => {
	const program = createInMemoryProgram(
		{
			[referenceFormsDependencyPath]: referenceFormsDependencySource,
			[referenceFormsSourcePath]: referenceFormsSource,
		},
		referenceFormsCompilerOptions,
	);
	const moduleDefinition = parseSerializedModule(referenceFormsSourcePath, program);
	const exportByName = createExportLookup(moduleDefinition);
	expectReferenceFormExports(exportByName);
});

it('preserves project reference forms through export specifiers', () => {
	const program = createInMemoryProgram(
		{
			[referenceFormsDependencyPath]: referenceFormsDependencySource,
			[referenceFormsSourcePath]: referenceFormsSource,
			[referenceFormsEntryPath]: referenceFormsEntrySource,
		},
		referenceFormsCompilerOptions,
	);
	const moduleDefinition = parseSerializedModule(referenceFormsEntryPath, program);
	const exportByName = createExportLookup(moduleDefinition);
	expectReferenceFormExports(exportByName);
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
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('IgnoredArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(exportByName('ReorderedArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
});

it('resolves keyof alias chains in their lexical namespace scope', () => {
	const filePath = '/virtual/keyof-namespace-shadowing.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type Keys = string;

export namespace Nested {
  export interface Params {
    nested: string;
  }
  export type Keys = keyof Params;
  export type PublicKeys = Keys;
}`,
		),
	);
	const publicKeys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Nested.PublicKeys',
	);

	expect(publicKeys?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params', namespaces: ['Nested'] } },
	});
});

it('does not treat locally shadowed Array names as built-in containers', () => {
	const filePath = '/virtual/keyof-shadowed-array-names.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
}

type Array<Ignored> = string[];
type ReadonlyArray<Ignored> = number[];
type Readonly<Ignored> = boolean[];

export type Mutable = Array<keyof Params>;
export type ReadonlyValues = ReadonlyArray<keyof Params>;
export type ShadowedUtility = Readonly<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('Mutable')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
	});
	expect(exportByName('Mutable')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('ReadonlyValues')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'number' },
	});
	expect(exportByName('ReadonlyValues')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('ShadowedUtility')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'boolean' },
	});
	expect(exportByName('ShadowedUtility')?.type).not.toHaveProperty('isReadonly');
});

it('does not change unrelated tuple member aliases when a sibling uses keyof', () => {
	const filePath = '/virtual/keyof-tuple-sibling.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
}

type WithBase<T> = { [K in keyof T]: T[K] };
type PropsOf<T> = WithBase<T>;

export type WithoutKeyof<T> = [PropsOf<T>, number];
export type WithKeyof<T> = [PropsOf<T>, keyof Params];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('WithoutKeyof')?.type.types[0].typeName).toMatchObject({ name: 'WithBase' });
	expect(exportByName('WithKeyof')?.type.types[0].typeName).toMatchObject({ name: 'WithBase' });
	expect(exportByName('WithKeyof')?.type.types[1]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
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
	const exportByName = createExportLookup(moduleDefinition);

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

  get asymmetricKey(): keyof Params {
    return this.accessorValue;
  }

  set asymmetricKey(value: keyof Params | undefined) {
    this.accessorValue = value ?? 'a';
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
	const exportByName = createExportLookup(moduleDefinition);

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
	for (const propertyName of [
		'instance',
		'value',
		'accessorKey',
		'pairedKey',
		'asymmetricKey',
		'setterKey',
	]) {
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

it('preserves class member keyof syntax when the instance is reached through an alias', () => {
	const filePath = '/virtual/keyof-class-instance-alias.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

class Example {
  field!: keyof Params;

  constructor(public parameter: keyof Params) {}

  get accessor(): keyof Params {
    return this.field;
  }

  set accessor(value: keyof Params) {
    this.field = value;
  }
}

export type Instance = Example;`,
		),
	);
	const properties = moduleDefinition.exports[0]?.type.properties;

	expect(properties).toHaveLength(3);
	for (const property of properties) {
		expect(property.type).toMatchObject({
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
		});
	}
});
