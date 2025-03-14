import { Documentation } from './documentation';
import { BaseNode } from './node';

export class EnumNode implements BaseNode {
	constructor(
		public name: string,
		public members: EnumMember[],
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'enum',
			name: this.name,
			members: this.members.map((member) => member.toObject()),
			documentation: this.documentation?.toObject(),
		};
	}
}

export class EnumMember implements BaseNode {
	constructor(
		public name: string,
		public value: string,
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			name: this.name,
			value: this.value,
			documentation: this.documentation?.toObject(),
		};
	}
}
