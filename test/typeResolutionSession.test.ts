import ts from 'typescript';
import { expect, it } from 'vitest';
import { IntrinsicNode, ObjectNode } from '../src';
import { resolveType } from '../src/parsers/typeResolver';
import { createInMemoryProgram } from './support/inMemoryProgram';
import { createTestParserContext } from './support/parserContext';

const filePath = '/virtual/session.ts';

function getDeclaredType(program: ts.Program, exportName: string): ts.Type {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath)!;
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)!;
	const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === exportName)!;
	return checker.getDeclaredTypeOfSymbol(symbol);
}

function getAliasType(program: ts.Program, exportName: string): ts.Type {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath)!;
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)!;
	const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === exportName)!;
	const declaration = symbol.declarations![0] as ts.TypeAliasDeclaration;
	return checker.getTypeAtLocation(declaration);
}

it('returns the cached node when the same type is resolved again at the same depth', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Point { x: number; y: number; }',
	);
	const { context } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Point');

	const first = resolveType(type, undefined, context);
	const second = resolveType(type, undefined, context);

	expect(first).toBeInstanceOf(ObjectNode);
	expect((first as ObjectNode).properties).toHaveLength(2);
	// Identity proves the second call hit the cache rather than re-resolving.
	expect(second).toBe(first);
});

it('breaks recursive types with a shallow placeholder instead of recursing forever', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Node { value: number; next: Node; }',
	);
	const { context } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Node');

	const resolved = resolveType(type, undefined, context) as ObjectNode;
	const next = resolved.properties.find((property) => property.name === 'next')!;

	expect(next.type).toBeInstanceOf(ObjectNode);
	// The self-reference resolves to a shallow node carrying the type name but no
	// expanded members, which is how the session terminates the cycle.
	expect((next.type as ObjectNode).properties).toHaveLength(0);
});

it('warns once and falls back to any for unsupported types', () => {
	const program = createInMemoryProgram(filePath, 'export type X = `prefix-${string}`;');
	const { context, warnings } = createTestParserContext(program, filePath);
	const type = getAliasType(program, 'X');

	const resolved = resolveType(type, undefined, context);

	expect(resolved).toBeInstanceOf(IntrinsicNode);
	expect((resolved as IntrinsicNode).intrinsic).toBe('any');
	expect(warnings.filter((warning) => warning.code === 'unsupported-type-fallback')).toHaveLength(
		1,
	);
});

it('does not cache unsupported fallbacks, so every occurrence warns again', () => {
	const program = createInMemoryProgram(filePath, 'export type X = `prefix-${string}`;');
	const { context, warnings } = createTestParserContext(program, filePath);
	const type = getAliasType(program, 'X');

	resolveType(type, undefined, context);
	resolveType(type, undefined, context);

	expect(warnings.filter((warning) => warning.code === 'unsupported-type-fallback')).toHaveLength(
		2,
	);
});

it('does not warn for fully supported types', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Point { x: number; y: number; }',
	);
	const { context, warnings } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Point');

	resolveType(type, undefined, context);

	expect(warnings).toHaveLength(0);
});
