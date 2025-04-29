export function test1(parameters: Params) {}

export function test2(
	inlineStringUnion: 'foo' | 'bar' | 'baz',
	inlineNumberUnion: 1 | 2 | 3,
	referencedStringUnion: StringUnion,
	referencedNumberUnion: NumberUnion,
	unionOfUnions: StringUnion | NumberUnion,
	indirectUnion: IndirectStringUnion | undefined,
) {}

export function test3(prop: keyof Params) {}

export interface Params {
	inlineStringUnion: 'foo' | 'bar' | 'baz';
	inlineNumberUnion: 1 | 2 | 3;
	referencedStringUnion: StringUnion;
	referencedNumberUnion: NumberUnion;
	callback: (ref: StringUnion | undefined) => void;
	unionOfUnions: StringUnion | NumberUnion;
	indirectUnion: IndirectStringUnion | undefined;
}

type StringUnion = 'foo' | 'bar' | 'baz';
type IndirectStringUnion = StringUnion | 'qux';
type NumberUnion = 1 | 2 | 3;
