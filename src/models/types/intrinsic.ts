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

	constructor(public name: IntrinsicType) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
		};
	}
}
