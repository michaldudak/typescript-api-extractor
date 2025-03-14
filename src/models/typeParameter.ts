import { BaseNode, TypeNode } from './node';

export class TypeParameterNode implements BaseNode {
	constructor(
		public name: string,
		public constraint: string | undefined,
		public defaultValue: TypeNode | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'typeParameter',
			name: this.name,
			constraint: this.constraint,
			defaultValue: this.defaultValue?.toObject(),
		};
	}
}
