interface Base {
	a: boolean;
	b?: string;
	c: number;
}

export function test1(params: Pick<Base, 'a' | 'b'>) {}

export function test2(params: Omit<Base, 'c'>): number {
	return 1;
}

export function test3(params: Parameters<typeof test1>) {}

export function test4(params: ReturnType<typeof test2>) {}
