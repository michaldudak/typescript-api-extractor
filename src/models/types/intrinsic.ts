import { TypeNode } from '../node';

type IntrinsicType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'bigint'
	| 'null'
	| 'undefined'
	| 'void'
	| 'any'
	| 'unknown'
	| 'function';

export class IntrinsicNode implements TypeNode {
	kind = 'intrinsic';
	parentNamespaces: string[] = [];

	constructor(public name: IntrinsicType) {}
}
