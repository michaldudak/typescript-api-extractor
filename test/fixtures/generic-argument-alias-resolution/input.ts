export function test(a: GenericObject<MyUnion>) {
	return null;
}

type GenericObject<T> = {
	x: T;
};

type MyUnion = string | number;
