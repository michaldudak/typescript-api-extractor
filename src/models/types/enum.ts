import { Documentation } from '../documentation';
import { TypeNode } from '../node';

export class EnumNode implements TypeNode {
	kind = 'enum';

	constructor(
		public name: string,
		public parentNamespaces: string[],
		public members: EnumMember[],
		public documentation: Documentation | undefined,
	) {}
}

export class EnumMember {
	constructor(
		public name: string,
		public value: string,
		public documentation: Documentation | undefined,
	) {}
}
