export interface A {
	a: Alias;
	r: MyRecord<string, string>;
	s: AliasToGeneric;
	n: AliasedAny;
	u: AliasedUnknown;

	oa?: Alias;
	or?: MyRecord<string, string>;
	os?: AliasToGeneric;
	on?: AliasedAny;
	ou?: AliasedUnknown;
}

export function fn1(
	a: Alias,
	r: MyRecord<string, string>,
	s: AliasToGeneric,
	n: AliasedAny,
	u: AliasedUnknown,
	oa?: Alias,
	or?: MyRecord<string, string>,
	os?: AliasToGeneric,
	on?: AliasedAny,
	ou?: AliasedUnknown,
) {}

type SomeType = 1 | 2;
type Alias = SomeType;
type MyRecord<Key extends string | number, Value> = Record<Key, Value>;
type AliasToGeneric = Set<number>;
type AliasedAny = any;
type AliasedUnknown = unknown;
