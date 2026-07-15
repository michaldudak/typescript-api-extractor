import { expect, it } from 'vitest';
import {
	ArrayNode,
	CallSignature,
	FunctionNode,
	IntrinsicNode,
	LiteralNode,
	Parameter,
	TupleNode,
	TypeOperatorNode,
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

function createUnaryFunction(parameterType: IntrinsicNode): FunctionNode {
	return new FunctionNode(undefined, [
		new CallSignature(
			[new Parameter(parameterType, 'value', undefined, false, undefined)],
			new IntrinsicNode('void'),
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
	const anyFunction = createUnaryFunction(new IntrinsicNode('any'));
	const stringFunction = createUnaryFunction(new IntrinsicNode('string'));

	expect(typeEquivalenceChecker.areEquivalentIgnoringAny(anyFunction, stringFunction)).toBe(true);
	expect(typeEquivalenceChecker.containsAny(anyFunction)).toBe(true);

	const canonicalUnion = new UnionNode(undefined, [anyFunction, stringFunction]);
	expect(canonicalUnion.types).toEqual([stringFunction]);

	const reverseCanonicalUnion = new UnionNode(undefined, [stringFunction, anyFunction]);
	expect(reverseCanonicalUnion.types).toEqual([stringFunction]);
});

it('replaces wildcard functions in place without merging later concrete overloads', () => {
	const prefix = new LiteralNode('"prefix"');
	const separator = new LiteralNode('"separator"');
	const anyFunction = createUnaryFunction(new IntrinsicNode('any'));
	const stringFunction = createUnaryFunction(new IntrinsicNode('string'));
	const numberFunction = createUnaryFunction(new IntrinsicNode('number'));

	const canonicalUnion = new UnionNode(undefined, [
		prefix,
		anyFunction,
		separator,
		stringFunction,
		numberFunction,
	]);

	expect(canonicalUnion.types).toEqual([prefix, stringFunction, separator, numberFunction]);
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

it('canonicalizes structurally equivalent type operator members', () => {
	const firstResolvedType = new UnionNode(undefined, [
		new LiteralNode('"a"'),
		new LiteralNode('"b"'),
	]);
	const secondResolvedType = new UnionNode(undefined, [
		new LiteralNode('"b"'),
		new LiteralNode('"a"'),
	]);
	for (const resolvedType of [firstResolvedType, secondResolvedType]) {
		Object.defineProperty(resolvedType, 'toString', {
			value: () => {
				throw new Error('resolvedType should not be stringified for canonicalization');
			},
		});
	}

	const firstOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
		firstResolvedType,
		'exact',
	);
	const secondOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
		secondResolvedType,
		'exact',
	);

	expect(new UnionNode(undefined, [firstOperator, secondOperator]).types).toEqual([firstOperator]);
});

it('compares ordered type-operator key unions in linear work', () => {
	const memberCount = 100;
	let renderCount = 0;
	const createResolvedType = () =>
		new UnionNode(
			undefined,
			Array.from({ length: memberCount }, (_, index) => {
				const member = new LiteralNode(`"key${index}"`);
				Object.defineProperty(member, 'toString', {
					value: () => {
						renderCount += 1;
						return member.value;
					},
				});
				return member;
			}),
		);
	const firstOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
		createResolvedType(),
		'exact',
	);
	const secondOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
		createResolvedType(),
		'exact',
	);

	expect(typeEquivalenceChecker.areEquivalentStrictly(firstOperator, secondOperator)).toBe(true);
	expect(renderCount).toBeLessThanOrEqual(memberCount * 2);
});

it('rejects distinct type-operator operands before comparing resolved keys', () => {
	let resolvedRenderCount = 0;
	const createResolvedType = () =>
		new UnionNode(
			undefined,
			Array.from({ length: 100 }, (_, index) => {
				const member = new LiteralNode(`"key${index}"`);
				Object.defineProperty(member, 'toString', {
					value: () => {
						resolvedRenderCount += 1;
						return member.value;
					},
				});
				return member;
			}),
		);
	const firstOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('First', undefined, undefined),
		createResolvedType(),
		'exact',
	);
	const secondOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('Second', undefined, undefined),
		createResolvedType(),
		'exact',
	);

	expect(typeEquivalenceChecker.areEquivalentStrictly(firstOperator, secondOperator)).toBe(false);
	expect(resolvedRenderCount).toBe(0);
});

it('keeps compatible exact provenance for resolved type operator construction', () => {
	const resolvedType = new LiteralNode('"value"');
	const operator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
		resolvedType,
		'exact',
	);
	const syntaxOnlyOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TypeParameterNode('T', undefined, undefined),
	);
	const compatibleOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		syntaxOnlyOperator.type,
		resolvedType,
	);

	expect(operator.resolutionKind).toBe('exact');
	expect(compatibleOperator.resolutionKind).toBe('exact');
	expect(compatibleOperator.resolvedType).toBe(resolvedType);
	expect(syntaxOnlyOperator.resolvedType).toBeUndefined();
	expect(syntaxOnlyOperator.resolutionKind).toBeUndefined();
	expect(syntaxOnlyOperator).not.toHaveProperty('resolvedType');
	expect(syntaxOnlyOperator).not.toHaveProperty('resolutionKind');
	expect(() => {
		// Exercise the runtime invariant for untyped JavaScript consumers.
		Reflect.construct(TypeOperatorNode, [
			undefined,
			'keyof',
			syntaxOnlyOperator.type,
			undefined,
			'exact',
		]);
	}).toThrow('resolutionKind requires resolvedType');
});

it('keeps type operators whose container operands differ by readonly', () => {
	const resolvedType = new LiteralNode('"length"');
	const mutableOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new ArrayNode(undefined, new IntrinsicNode('string')),
		resolvedType,
		'exact',
	);
	const readonlyOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new ArrayNode(undefined, new IntrinsicNode('string'), true),
		resolvedType,
		'exact',
	);

	expect(typeEquivalenceChecker.areEquivalentStrictly(mutableOperator, readonlyOperator)).toBe(
		false,
	);
	expect(new UnionNode(undefined, [mutableOperator, readonlyOperator]).types).toEqual([
		mutableOperator,
		readonlyOperator,
	]);
});

it('keeps type operators whose tuple operands differ by readonly', () => {
	const resolvedType = new LiteralNode('"0"');
	const mutableOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TupleNode(undefined, [new IntrinsicNode('string')]),
		resolvedType,
		'exact',
	);
	const readonlyOperator = new TypeOperatorNode(
		undefined,
		'keyof',
		new TupleNode(undefined, [new IntrinsicNode('string')], true),
		resolvedType,
		'exact',
	);

	expect(typeEquivalenceChecker.areEquivalentStrictly(mutableOperator, readonlyOperator)).toBe(
		false,
	);
	expect(new UnionNode(undefined, [mutableOperator, readonlyOperator]).types).toEqual([
		mutableOperator,
		readonlyOperator,
	]);
});

it('keeps type operators whose resolved-result provenance differs', () => {
	const operators = (['exact', 'baseConstraint', 'fallback'] as const).map(
		(resolutionKind) =>
			new TypeOperatorNode(
				undefined,
				'keyof',
				new TypeParameterNode('T', undefined, undefined),
				new LiteralNode('"value"'),
				resolutionKind,
			),
	);

	for (let leftIndex = 0; leftIndex < operators.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < operators.length; rightIndex += 1) {
			expect(
				typeEquivalenceChecker.areEquivalentStrictly(operators[leftIndex], operators[rightIndex]),
			).toBe(false);
		}
	}
	expect(new UnionNode(undefined, operators).types).toEqual(operators);
});
