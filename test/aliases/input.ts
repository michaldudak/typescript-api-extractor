export interface A {
	a: Alias;
	r: MyRecord<string, string>;
}

export function fn1(a: Alias, r: MyRecord<string, string>) {}

type SomeType = 1 | 2;
type Alias = SomeType;
type MyRecord<Key extends string | number, Value> = Record<Key, Value>;
