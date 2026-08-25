import { mergedTarget } from './helpers';

// A type alias and a constant annotated with it resolve to the same literal
// type; only the declaration spaces tell them apart.
export type PlainAlias = 'alias';

export const annotatedConstant: PlainAlias = 'alias';

export const plainConstant = 'constant';

export function plainFunction(): string {
	return 'function';
}

// Expando assignments make the binder set SymbolFlags.Module, but they do not
// declare a namespace.
export function expandoFunction(): string {
	return 'expando';
}
expandoFunction.extra = 'extra';

export class PlainClass {
	id: string = 'class';
}

export enum PlainEnum {
	member = 'member',
}

export interface PlainInterface {
	id: string;
}

// Merged declarations occupy both the value and the type space.
export interface Merged {
	id: string;
}

export const Merged: Merged = { id: 'merged' };

// An imported value merged with a local interface occupies the spaces of both.
interface mergedTarget {
	id: string;
}

export { mergedTarget };

// A namespace containing only types occupies just the namespace space. It is
// exported through a specifier because a directly exported namespace is
// flattened into its members.
namespace TypesNamespace {
	export type Nested = 'nested';
}

export type { TypesNamespace };

// Type-only re-exports never occupy the value space, whatever their target is.
export type { ReexportedAlias, ReexportedClass } from './helpers';

export { reexportedValue } from './helpers';

// An enum survives a type-only star export as a type, not as a value.
export type * from './enums';
