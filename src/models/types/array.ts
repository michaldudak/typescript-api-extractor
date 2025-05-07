import { TypeNode } from '../node';

export class ArrayNode implements TypeNode {
	kind = 'array';
	constructor(
		public name: string | undefined,
		public parentNamespaces: string[],
		public elementType: TypeNode,
	) {}
}
