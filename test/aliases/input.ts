export interface A {
	a: Alias;
	r: MyRecord<string, string>;
	s: AliasToGeneric;
}

export function fn1(a: Alias, r: MyRecord<string, string>, s: AliasToGeneric) {}

type SomeType = 1 | 2;
type Alias = SomeType;
type MyRecord<Key extends string | number, Value> = Record<Key, Value>;
type AliasToGeneric = Set<number>;
