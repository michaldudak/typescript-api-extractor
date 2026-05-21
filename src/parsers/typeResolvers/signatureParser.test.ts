import { expect, it } from 'vitest';
import { parseFromProgram } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const returnAliasSource = `type WithBase<T> = { [K in keyof T]: T[K] };
type PropsOf<T> = WithBase<T>;

export function getProps<T>(): PropsOf<T> {
  return undefined as any;
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
