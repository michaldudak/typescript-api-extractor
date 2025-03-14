import { BaseNode, TypeNode } from './node';

export class ArrayNode implements BaseNode {
	constructor(public type: TypeNode) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'array',
			type: this.type.toObject(),
		};
	}
}
