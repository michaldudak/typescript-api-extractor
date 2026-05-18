import { expect, it } from 'vitest';
import {
	CallSignature,
	FunctionNode,
	IntrinsicNode,
	LiteralNode,
	Parameter,
	UnionNode,
	typeEquivalenceChecker,
} from '../src';

it('canonicalizes compound members from the union constructor', () => {
	const canonicalUnion = new UnionNode(undefined, [
		new IntrinsicNode('undefined'),
		new UnionNode(undefined, [new LiteralNode('true'), new LiteralNode('false')]),
		new IntrinsicNode('never'),
		new IntrinsicNode('string'),
		new IntrinsicNode('string'),
	]);

	expect(canonicalUnion.types.map((type) => type.toString())).toEqual([
		'boolean',
		'string',
		'undefined',
	]);
});

it('uses type equivalence when canonicalizing duplicate function members', () => {
	const anyFunction = new FunctionNode(undefined, [
		new CallSignature(
			[new Parameter(new IntrinsicNode('any'), 'value', undefined, false, undefined)],
			new IntrinsicNode('void'),
		),
	]);
	const stringFunction = new FunctionNode(undefined, [
		new CallSignature(
			[new Parameter(new IntrinsicNode('string'), 'value', undefined, false, undefined)],
			new IntrinsicNode('void'),
		),
	]);

	expect(typeEquivalenceChecker.areEquivalentIgnoringAny(anyFunction, stringFunction)).toBe(true);
	expect(typeEquivalenceChecker.containsAny(anyFunction)).toBe(true);

	const canonicalUnion = new UnionNode(undefined, [anyFunction, stringFunction]);
	expect(canonicalUnion.types).toEqual([stringFunction]);
});
