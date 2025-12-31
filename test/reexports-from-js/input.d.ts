// This file simulates built output where .d.ts imports from .js files
import {
	FormattedProperty,
	FormattedParameter,
	Container,
	ProcessingStatus,
	formatType,
	parseParameters,
} from './source.js';

// Re-export types directly
export type { FormattedProperty, FormattedParameter };

// Re-export with renaming
export type { Container as TypeContainer };

// Re-export a const enum pattern
export { ProcessingStatus };

// Re-export functions
export { formatType, parseParameters };

// Function using re-exported types as both parameter and return type
export function processType(input: FormattedParameter): FormattedProperty;

// Function using re-exported generic type
export function wrapValue<T>(value: T): Container<T>;
