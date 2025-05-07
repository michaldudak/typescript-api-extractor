import { TypeNode } from '../node';
import { Documentation } from '../documentation';
import { PropertyNode } from '../property';

export class ObjectNode implements TypeNode {
	kind = 'object';

	constructor(
		public name: string | undefined,
		public parentNamespaces: string[],
		public properties: PropertyNode[],
		public documentation: Documentation | undefined,
	) {}
}
