function testFunction1(): [string, number] {
	return ['hello', 42];
}

function testFunction2(): [s: string, n: number] {
	return ['hello', 42];
}

function testFunction3(): TupleType {
	return ['hello', 42];
}

function testFunction4(): NamedTupleType {
	return ['hello', 42];
}

type TupleType = [string, number];

type NamedTupleType = [s: string, n: number];
