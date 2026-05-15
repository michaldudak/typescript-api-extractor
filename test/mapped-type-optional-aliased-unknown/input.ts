type U = unknown;

export type T<K extends string = string> = {
	[P in K]?: U;
};
