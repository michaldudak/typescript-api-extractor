import { Documentation } from '../documentation';
import { TypeNode } from '../node';
import { TypeName } from '../typeName';

export class EnumNode implements TypeNode {
	readonly kind = 'enum';

	constructor(
		public typeName: TypeName,
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
