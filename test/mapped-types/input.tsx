interface Base {
	a: boolean;
	b: string;
}

type PartialType = Partial<Base>;
type ReadonlyType = Readonly<Base>;

export function test1(params: PartialType) {}

export function test2(params: ReadonlyType) {}

export function test3(params: Partial<Base>) {}

export function test4(params: Readonly<Base>) {}
