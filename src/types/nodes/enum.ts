import { Documentation } from '../documentation';

export class EnumNode {
	constructor(
		public name: string,
		public members: EnumMember[],
		public documentation: Documentation | undefined,
	) {}
}

export interface EnumMember {
	name: string;
	value: string;
	documentation: Documentation | undefined;
}
