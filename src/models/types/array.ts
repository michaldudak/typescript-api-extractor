import { TypeNode } from '../node';

export class ArrayNode implements TypeNode {
	kind = 'array';
	constructor(
		public name: string | undefined,
		public elementType: TypeNode,
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			elementType: this.elementType.toObject(),
		};
	}
}
