export function test1(a: A & B) {}
export function test2(a: AB) {}

interface A {
	a: string;
	b: number;
}

interface B {
	a?: string;
	c?: number;
}

type AB = A & B;
