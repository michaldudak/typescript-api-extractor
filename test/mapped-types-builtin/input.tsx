interface Base {
	a: boolean;
	b?: string;
}

type PartialType = Partial<Base>;
type RequiredType = Required<Base>;

export function test1(params: PartialType) {}

export function test2(params: RequiredType) {}

export function test3(params: Partial<Base>) {}

export function test4(params: Required<Base>) {}
