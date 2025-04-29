export function test1(parameters: Params) {}

export function test2(
	inlineStringUnion: 'foo' | 'bar' | 'baz',
	inlineNumberUnion: 1 | 2 | 3,
	referencedStringUnion: StringUnion,
	referencedNumberUnion: NumberUnion,
	unionOfUnions: StringUnion | NumberUnion,
) {}

export function test3(prop: keyof Params) {}

export interface Params {
	inlineStringUnion: 'foo' | 'bar' | 'baz';
	inlineNumberUnion: 1 | 2 | 3;
	referencedStringUnion: StringUnion;
	referencedNumberUnion: NumberUnion;
	callback: (ref: StringUnion | undefined) => void;
	unionOfUnions: StringUnion | NumberUnion;
	unionAndLiteral: StringUnion | 'qux';
}

type StringUnion = 'foo' | 'bar' | 'baz';
type NumberUnion = 1 | 2 | 3;
