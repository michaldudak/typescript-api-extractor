export function test1(a: A & B) {}
export function test2(a: AB) {}
export function test3(a: WithMethod) {}

interface A {
	a: string;
	b: number;
}

interface B {
	a?: string;
	c?: number;
}

type AB = A & B;

type WithMethod = A & {
	doSomething(): void;
};
