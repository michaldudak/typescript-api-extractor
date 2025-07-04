export function f1(x: Params) {}
export function f2(x: Params<string>) {}
export function f3(x: Params<number>) {}
export function f4<T>(x: Params<T>) {}

export function f5(x: Params2<string, number>) {}
export function f6(x: Params2<string, string>) {}
export function f7(x: Params2<number, number>) {}

export function f8(x: Params2<string>) {}
export function f9(x: Params2<number>) {}

interface Params<T = string> {
	v: T;
}

interface Params2<T = string, U = number> {
	v: T;
	u: U;
}
