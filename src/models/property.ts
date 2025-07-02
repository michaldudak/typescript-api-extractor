import { Documentation } from './documentation';
import { TypeNode } from './node';

export class PropertyNode {
	constructor(
		public name: string,
		public type: TypeNode,
		public documentation: Documentation | undefined,
		public optional: boolean,
	) {}
}
