import { BaseNode, TypeNode } from './node';

export class TupleNode implements BaseNode {
	constructor(public types: TypeNode[]) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'tuple',
			types: this.types.map((type) => type.toObject()),
		};
	}
}
