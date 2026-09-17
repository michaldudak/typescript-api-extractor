import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const templateLiteralSource = `export type Fraction = \`\${number}fr\`;
export type Handler<T extends string> = \`on\${T}\`;`;

it('resolves template literals and their placeholders without warnings', () => {
	const filePath = '/virtual/template-literal.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, templateLiteralSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'Fraction',
			type: {
				kind: 'templateLiteral',
				texts: ['', 'fr'],
				types: [{ kind: 'intrinsic', intrinsic: 'number' }],
			},
		},
		{
			name: 'Handler',
			type: {
				kind: 'templateLiteral',
				texts: ['on', ''],
				types: [{ kind: 'typeParameter', name: 'T' }],
			},
		},
	]);
	expect(String(moduleDefinition.exports[1]?.type)).toBe('`on${T}`');
	expect(warnings).toEqual([]);
});

it('keeps template literals intact when external types are included', () => {
	const filePath = '/virtual/template-literal-external-types.ts';

	// The apparent type of a template literal is `String`, whose members would
	// otherwise be expanded once its external declaration is allowed.
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, templateLiteralSource),
		{ includeExternalTypes: true },
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'templateLiteral',
		texts: ['', 'fr'],
		types: [{ kind: 'intrinsic', intrinsic: 'number' }],
	});
});
