import { TypeNode } from '../node';

export class ExternalTypeNode implements TypeNode {
	kind = 'external';

	constructor(
		public name: string,
		public parentNamespaces: string[],
	) {}
}
