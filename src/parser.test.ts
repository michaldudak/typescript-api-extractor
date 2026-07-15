import ts from 'typescript';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import {
	parseFromProgram,
	TypeOperatorNode,
	type ModuleNode,
	type ParserOptions,
	type ParserWarning,
	type TypeOperatorResolutionKind,
} from './index';
import { type ScopedParserContext } from './parserContext';
import { parseExport } from './parsers/exportParser';
import { createInMemoryProgram } from '../test/support/inMemoryProgram';

afterEach(() => {
	vi.restoreAllMocks();
});

const unsupportedTypeSource = 'export type X = `prefix-${string}`;';
const repeatedUnsupportedTypeSource = `type Weird = \`prefix-\${string}\`;

export interface Props {
  a: Weird;
  b: Weird;
}`;
const symbolStackRestorationSource = `type Weird = \`prefix-\${string}\`;

export interface Props {
  nested: Weird;
}

export type AfterProps = Weird;`;
const implicitClassParameterSource = `export class ClassWarnings {
  methodImplicit<T extends string>(
    value = undefined as \`prefix-\${T}\`,
  ): void {}
}`;
const preciseWarningSource = `export function functionReturn():
  \`function-\${string}\` {
  return undefined as any;
}

export class ClassWarnings {
  methodParam(
    value: \`param-\${string}\`,
  ): void {}

  methodReturn():
    \`return-\${string}\` {
    return undefined as any;
  }

  property:
    \`property-\${string}\`;
}`;
const sourceNodeRestorationSource = `export function withReturn():
  \`return-\${string}\` {
  return undefined as any;
}

export type AfterReturn = \`alias-\${string}\`;`;
const aliasWithExtraResolvedTypeArgumentsSource = `interface Extras<T> {
  pending: T;
}

type Result<T> = [T, (next: T) => void, Extras<T>];

interface Options<T, P> {
  causesLayoutShift: (t: T) => boolean;
  preload?: (t: T) => P | Promise<P>;
}

type FixedOptions<P> = Options<string | null, P>;

export function useThing<T, P = void>(
  initial: T,
  options: Options<T, P>,
): Result<T> {
  return [initial, () => {}, { pending: initial }] as Result<T>;
}

export function useFixed<P = void>(
  options: FixedOptions<P>,
): Result<string | null> {
  return useThing<string | null, P>(null, options);
}`;

function getExpectedUnsupportedTypeWarningMessage(filePath: string): string {
	return `Type extraction warning: Unable to handle type "\`prefix-\${string}\`" with flag "TemplateLiteral" at "${filePath}:1:17". Using any instead.`;
}

it('reports unsupported type fallbacks through onWarning', () => {
	const filePath = '/virtual/unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const parserOptions: ParserOptions = {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	};

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource), parserOptions);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'unsupported-type-fallback',
		filePath,
		line: 1,
		column: 17,
		parsedSymbolStack: [filePath, 'X'],
		typeFlags: ['TemplateLiteral'],
		typeText: '`prefix-${string}`',
		sourceText: '`prefix-${string}`',
	});
	expect(warnings[0]!.message).toBe(getExpectedUnsupportedTypeWarningMessage(filePath));
	expect(warnings[0]!.message).toContain('Type extraction warning:');
	expect(warnings[0]!.message).not.toContain('IncludesWildcard');
});

it('logs unsupported type fallbacks by default', () => {
	const filePath = '/virtual/default-unsupported-type-warning.ts';
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource));

	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn).toHaveBeenCalledWith(getExpectedUnsupportedTypeWarningMessage(filePath));
});

it('reports unsupported type fallbacks for repeated cached types', () => {
	const filePath = '/virtual/repeated-unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, repeatedUnsupportedTypeSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			line: 4,
			column: 6,
			sourceText: 'Weird',
			parsedSymbolStack: [filePath, 'Props', 'property: a'],
		}),
		expect.objectContaining({
			line: 5,
			column: 6,
			sourceText: 'Weird',
			parsedSymbolStack: [filePath, 'Props', 'property: b'],
		}),
	]);
});

// Warning metadata is the public symptom of parser-context scope leaks, so these
// tests pin down stack restoration without coupling to the context implementation.
it('restores parser context after nested property warnings', () => {
	const filePath = '/virtual/symbol-stack-restoration.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, symbolStackRestorationSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			sourceText: 'Weird',
			parsedSymbolStack: [filePath, 'Props', 'property: nested'],
		}),
		expect.objectContaining({
			sourceText: 'Weird',
			parsedSymbolStack: [filePath, 'AfterProps'],
		}),
	]);
});

it('restores source-node context after nested signature warnings', () => {
	const filePath = '/virtual/source-node-restoration.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, sourceNodeRestorationSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			line: 2,
			sourceText: '`return-${string}`',
			parsedSymbolStack: [filePath, 'withReturn'],
		}),
		expect.objectContaining({
			line: 6,
			sourceText: '`alias-${string}`',
			parsedSymbolStack: [filePath, 'AfterReturn'],
		}),
	]);
});

it('reports implicit class parameter fallback locations at the parameter site', () => {
	const filePath = '/virtual/implicit-class-parameter-warning.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, implicitClassParameterSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'unsupported-type-fallback',
		line: 3,
		column: 5,
		parsedSymbolStack: [filePath, 'ClassWarnings', 'parameter: value'],
		typeFlags: ['TemplateLiteral'],
		typeText: '`prefix-${T}`',
	});
});

it('reports precise type locations in functions, class signatures, and class properties', () => {
	const filePath = '/virtual/precise-warning-locations.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, preciseWarningSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(4);
	expect(unsupportedWarnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				line: 2,
				column: 3,
				sourceText: '`function-${string}`',
				parsedSymbolStack: [filePath, 'functionReturn'],
			}),
			expect.objectContaining({
				line: 8,
				column: 12,
				sourceText: '`param-${string}`',
				parsedSymbolStack: [filePath, 'ClassWarnings', 'parameter: value'],
			}),
			expect.objectContaining({
				line: 12,
				column: 5,
				sourceText: '`return-${string}`',
				parsedSymbolStack: [filePath, 'ClassWarnings'],
			}),
			expect.objectContaining({
				line: 17,
				column: 5,
				sourceText: '`property-${string}`',
				parsedSymbolStack: [filePath, 'ClassWarnings'],
				typeFlags: ['TemplateLiteral'],
				typeText: '`property-${string}`',
			}),
		]),
	);
	for (const warning of unsupportedWarnings) {
		expect(warning.line).not.toBe(1);
		expect(warning.column).not.toBe(1);
	}
});

it('parses generic aliases whose resolved types expose extra type arguments', () => {
	const filePath = '/virtual/alias-extra-resolved-type-arguments.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, aliasWithExtraResolvedTypeArgumentsSource),
	);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'useThing',
			type: {
				callSignatures: [
					{
						returnValueType: {
							kind: 'tuple',
							typeName: {
								name: 'Result',
								typeArguments: [
									expect.objectContaining({ equalToDefault: false }),
									expect.objectContaining({ equalToDefault: false }),
									expect.objectContaining({ equalToDefault: false }),
								],
							},
						},
					},
				],
			},
		},
		{
			name: 'useFixed',
			type: {
				callSignatures: [
					{
						parameters: [
							{
								type: {
									typeName: {
										name: 'FixedOptions',
										typeArguments: [
											expect.objectContaining({ equalToDefault: false }),
											expect.objectContaining({ equalToDefault: false }),
										],
									},
								},
							},
						],
					},
				],
			},
		},
	]);
});

it('correlates type operator payloads with the selected output mode', () => {
	const filePath = '/virtual/type-operator-output-types.ts';
	const source = `export interface Props { key: keyof { value: string } }
interface Box<T> { value: T }
export function useBox(value: Box<keyof Props>): void {}`;
	const program = createInMemoryProgram(filePath, source);

	const resolvedModule = parseFromProgram(filePath, program);
	const compatibleModule: ModuleNode = resolvedModule;
	const resolvedType = resolvedModule.exports[0]!.type;
	if (resolvedType.kind === 'object') {
		const nestedType = resolvedType.properties[0]!.type;
		if (nestedType.kind === 'typeOperator') {
			expect(nestedType.resolvedType.kind).toBeDefined();
			const resolutionKind: TypeOperatorResolutionKind = nestedType.resolutionKind;
			expect(resolutionKind).toBe('exact');
		}
	}
	const explicitResolvedModule = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'resolved',
	});
	const explicitResolvedType = explicitResolvedModule.exports[0]!.type;
	if (explicitResolvedType.kind === 'object') {
		const nestedType = explicitResolvedType.properties[0]!.type;
		if (nestedType.kind === 'typeOperator') {
			expect(nestedType.resolvedType.kind).toBeDefined();
		}
	}

	const syntaxOnlyModule = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'syntaxOnly',
	});
	const syntaxOnlyType = syntaxOnlyModule.exports[0]!.type;
	if (syntaxOnlyType.kind === 'object') {
		const nestedType = syntaxOnlyType.properties[0]!.type;
		if (nestedType.kind === 'typeOperator') {
			expect(nestedType).toBeInstanceOf(TypeOperatorNode);
			expectTypeOf(nestedType.resolvedType).toEqualTypeOf<undefined>();
			expect(nestedType).not.toHaveProperty('resolvedType');
			if (nestedType instanceof TypeOperatorNode) {
				expectTypeOf(nestedType.resolvedType).toEqualTypeOf<undefined>();
			}
		}
	}
	const syntaxOnlyFunction = syntaxOnlyModule.exports.find(
		(parsedExport) => parsedExport.name === 'useBox',
	)!.type;
	if (syntaxOnlyFunction.kind === 'function') {
		const parameterType = syntaxOnlyFunction.callSignatures[0]!.parameters[0]!.type;
		if (parameterType.kind === 'object') {
			const typeArgument = parameterType.typeName?.typeArguments?.[0]?.type;
			if (typeArgument?.kind === 'typeOperator') {
				expectTypeOf(typeArgument.resolvedType).toEqualTypeOf<undefined>();
			}
		}
		const syntaxOnlyCopy = syntaxOnlyModule.exports
			.find((parsedExport) => parsedExport.name === 'useBox')!
			.withType(syntaxOnlyFunction);
		if (syntaxOnlyCopy.type.kind === 'function') {
			const copiedParameterType = syntaxOnlyCopy.type.callSignatures[0]!.parameters[0]!.type;
			if (copiedParameterType.kind === 'object') {
				const copiedTypeArgument = copiedParameterType.typeName?.typeArguments?.[0]?.type;
				if (copiedTypeArgument?.kind === 'typeOperator') {
					expectTypeOf(copiedTypeArgument.resolvedType).toEqualTypeOf<undefined>();
				}
			}
		}
	}

	const dynamicOptions: ParserOptions = { typeOperatorOutput: 'syntaxOnly' };
	const dynamicModule = parseFromProgram(filePath, program, dynamicOptions);
	const dynamicType = dynamicModule.exports[0]!.type;
	if (dynamicType.kind === 'object') {
		const nestedType = dynamicType.properties[0]!.type;
		if (nestedType.kind === 'typeOperator') {
			expect(nestedType).toBeInstanceOf(TypeOperatorNode);
			// @ts-expect-error A dynamic output mode may omit the checker payload.
			expect(nestedType.resolvedType.kind).toBeDefined();
			if (nestedType instanceof TypeOperatorNode) {
				// @ts-expect-error instanceof does not imply a resolved dynamic-mode payload.
				expect(nestedType.resolvedType.kind).toBeDefined();
			}
			if (nestedType.resolvedType) {
				expect(nestedType.resolvedType.kind).toBeDefined();
			}
			expect(nestedType.resolvedType).toBeUndefined();
		}
	}

	expect(compatibleModule.exports[0]).toBeDefined();
	expect(resolvedModule.exports[0]).toBeDefined();
	expect(syntaxOnlyModule.exports[0]).toBeDefined();
});

it('reports missing enum declarations through onWarning', () => {
	const sourceFile = ts.createSourceFile(
		'/virtual/missing-enum-declaration.ts',
		'export enum Missing {}',
		ts.ScriptTarget.ES2022,
		true,
	);
	const enumDeclaration = sourceFile.statements[0]!;
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];
	const context = {
		checker: {
			getSymbolAtLocation: () => ({ name: 'Missing' }),
		},
		sourceFile,
		parsedSymbolStack,
		sourceNodeStack,
		onWarning: (warning: ParserWarning) => {
			warnings.push(warning);
		},
		runWithSymbolScope: <T>(symbolName: string, callback: () => T): T => {
			parsedSymbolStack.push(symbolName);
			try {
				return callback();
			} finally {
				parsedSymbolStack.pop();
			}
		},
		runWithSourceNodeScope: <T>(sourceNode: ts.Node | undefined, callback: () => T): T => {
			if (sourceNode) {
				sourceNodeStack.push(sourceNode);
			}
			try {
				return callback();
			} finally {
				if (sourceNode) {
					sourceNodeStack.pop();
				}
			}
		},
		runWithTypeParameterSubstitutionScope: <T>(
			_substitutions: Map<ts.Symbol, ts.Type>,
			callback: () => T,
		): T => callback(),
	} as unknown as ScopedParserContext;

	parseExport(
		{
			name: 'Missing',
			declarations: [enumDeclaration],
		} as unknown as ts.Symbol,
		context,
	);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'missing-enum-declaration',
		filePath: sourceFile.fileName,
		line: 1,
		column: 1,
		parsedSymbolStack: ['Missing'],
		enumName: 'Missing',
	});
});

it('reports missing default export symbols through onWarning', () => {
	const filePath = '/virtual/missing-default-export-symbol.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, 'export default 1;'),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(warn).not.toHaveBeenCalled();
	expect(error).not.toHaveBeenCalled();
	expect(moduleDefinition.exports).toEqual([]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'missing-default-export-symbol',
		filePath,
		line: 1,
		column: 16,
		parsedSymbolStack: [filePath, 'default'],
		sourceText: '1',
	});
	expect(warnings[0]!.message).toBe(
		`Type extraction warning: Could not find the symbol of default export "1" at "${filePath}:1:16". Skipping this export.`,
	);
});
