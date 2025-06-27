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
	intrinsic: IntrinsicType;
	name: string | undefined;

	constructor(
		intrinsic: IntrinsicType,
		name: string | undefined = undefined,
		parentNamespaces: string[] = [],
	) {
		this.intrinsic = intrinsic;
		this.name = name;
		this.parentNamespaces = parentNamespaces;
	}
}
