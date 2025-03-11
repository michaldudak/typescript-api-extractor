function test1(parameters: Params) {}
function test2(
	inlineStringUnion: 'foo' | 'bar' | 'baz',
	inlineNumberUnion: 1 | 2 | 3,
	referencedStringUnion: StringUniuon,
	referencedNumberUnion: NumberUnion,
) {}

interface Params {
	inlineStringUnion: 'foo' | 'bar' | 'baz';
	inlineNumberUnion: 1 | 2 | 3;
	referencedStringUnion: StringUniuon;
	referencedNumberUnion: NumberUnion;
}

type StringUniuon = 'foo' | 'bar' | 'baz';
type NumberUnion = 1 | 2 | 3;
