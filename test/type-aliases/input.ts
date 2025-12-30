export type SimpleAlias = string;

export type UnionAlias = 'a' | 'b' | 'c';

export type ObjectAlias = {
	name: string;
	age: number;
};

export type GenericAlias<T> = {
	value: T;
	isValid: boolean;
};

export type ConditionalAlias<T> = T extends string ? 'string' : 'other';

interface BaseInterface {
	id: string;
}

export type ExtendedAlias = BaseInterface & {
	extra: boolean;
};
