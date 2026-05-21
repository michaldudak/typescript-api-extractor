import { expect, it } from 'vitest';
import {
	CallSignature,
	FunctionNode,
	IntrinsicNode,
	LiteralNode,
	Parameter,
	TypeParameterNode,
	UnionNode,
	typeEquivalenceChecker,
} from '../index';

function createGenericFunction(
	typeParameterName: string,
	constraint: IntrinsicNode,
	defaultValue?: IntrinsicNode,
): FunctionNode {
	const typeParameter = new TypeParameterNode(typeParameterName, constraint, defaultValue);

	return new FunctionNode(undefined, [
		new CallSignature(
			[new Parameter(typeParameter, 'value', undefined, false, undefined)],
			typeParameter,
			[typeParameter],
		),
	]);
}

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

it('canonicalizes alpha-equivalent generic function members', () => {
	const functionWithT = createGenericFunction('T', new IntrinsicNode('string'));
	const functionWithU = createGenericFunction('U', new IntrinsicNode('string'));

	expect(typeEquivalenceChecker.areEquivalentIgnoringAny(functionWithT, functionWithU)).toBe(true);

	const canonicalUnion = new UnionNode(undefined, [functionWithT, functionWithU]);
	expect(canonicalUnion.types).toEqual([functionWithT]);
});

it('keeps generic function members with different constraints or defaults', () => {
	const stringConstrained = createGenericFunction('T', new IntrinsicNode('string'));
	const numberConstrained = createGenericFunction('U', new IntrinsicNode('number'));
	const stringDefault = createGenericFunction(
		'T',
		new IntrinsicNode('string'),
		new IntrinsicNode('string'),
	);
	const numberDefault = createGenericFunction(
		'U',
		new IntrinsicNode('string'),
		new IntrinsicNode('number'),
	);

	expect(
		typeEquivalenceChecker.areEquivalentIgnoringAny(stringConstrained, numberConstrained),
	).toBe(false);
	expect(typeEquivalenceChecker.areEquivalentIgnoringAny(stringDefault, numberDefault)).toBe(false);

	expect(new UnionNode(undefined, [stringConstrained, numberConstrained]).types).toEqual([
		stringConstrained,
		numberConstrained,
	]);
	expect(new UnionNode(undefined, [stringDefault, numberDefault]).types).toEqual([
		stringDefault,
		numberDefault,
	]);
});
