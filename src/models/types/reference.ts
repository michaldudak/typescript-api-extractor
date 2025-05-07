import { TypeNode } from '../node';

export class ReferenceNode implements TypeNode {
	kind = 'reference';

	constructor(
		public name: string,
		public parentNamespaces: string[],
	) {}
}
