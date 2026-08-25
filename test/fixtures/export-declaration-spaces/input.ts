// A type alias and a constant annotated with it resolve to the same literal
// type; only the declaration spaces tell them apart.
export type PlainAlias = 'alias';

export const annotatedConstant: PlainAlias = 'alias';

export const plainConstant = 'constant';

export function plainFunction(): string {
	return 'function';
}

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

// A namespace containing only types occupies just the namespace space.
export namespace TypesNamespace {
	export type Nested = 'nested';
}

export type { ReexportedAlias } from './helpers';

export { reexportedValue } from './helpers';
