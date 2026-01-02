// Test index signature types with various key names and patterns

// Basic index signatures
export type StringIndexType = { [key: string]: number };
export type NumberIndexType = { [key: number]: string };

// Custom key names (should preserve key name)
export type TypeWithCustomKeyName = { [fileName: string]: number };
export type TypeWithNestedCustomKey = { [customKey: string]: { nested: boolean } };
export type SimpleIndex = { [myKey: string]: boolean };

// Index signature with complex value type
export type VariantExtraFiles = {
	[fileName: string]: { source: string | null };
};

// Nested index signature
export type OuterType = {
	inner: { [customKey: string]: number };
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

// Function with index signature parameters
export function test1(
	stringIndex: { [key: string]: number },
	numberIndex: { [key: number]: string },
	mixedIndex: { [key: string]: boolean | string },
) {}

// Function that returns index signature type
export function test2(): { [key: string]: number } {
	return {};
}

// Component with index signature in props
export function MyComponent(props: { className?: string; [key: string]: unknown }) {
	return null;
}

// Imported index signature types (from helper file)
import { HelperType } from './helper';

export type MyType = HelperType;
export { HelperType };

export interface MyInterface {
	data: HelperType;
}
