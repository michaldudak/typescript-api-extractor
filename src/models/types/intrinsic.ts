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
	parentNamespaces: string[];
	name: IntrinsicType;
	alias: string | undefined;

	constructor(
		name: IntrinsicType,
		alias: string | undefined = undefined,
		parentNamespaces: string[] = [],
	) {
		this.name = name;
		this.alias = alias;
		this.parentNamespaces = parentNamespaces;
	}
}
