import { BaseNode } from './node';

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

export class IntrinsicNode implements BaseNode {
	constructor(public type: IntrinsicType) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'intrinsic',
			type: this.type,
		};
	}
}
