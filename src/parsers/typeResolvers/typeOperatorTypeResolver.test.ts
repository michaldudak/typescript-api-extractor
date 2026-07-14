import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parseFromProgram } from '../../index';
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
export type KeyTuple = [keyof Params];`,
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
