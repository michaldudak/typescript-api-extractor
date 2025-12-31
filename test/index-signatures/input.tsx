// Test index signature types
export function test1(
	stringIndex: { [key: string]: number },
	numberIndex: { [key: number]: string },
	mixedIndex: { [key: string]: boolean | string },
) {}

// Type aliases with index signatures
export type StringIndexType = {
	[key: string]: number;
};

export type NumberIndexType = {
	[key: number]: string;
};

// Mixed with regular properties
export type MixedType = {
	fixedProp: string;
	[key: string]: string | number;
};

// Interface with index signature
export interface IndexedInterface {
	[key: string]: unknown;
}

// Function that returns index signature type
export function test2(): { [key: string]: number } {
	return {};
}

// Component with index signature in props
export function MyComponent(props: { className?: string; [key: string]: unknown }) {
	return null;
}
