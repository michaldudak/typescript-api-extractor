import { BaseNode, TypeNode } from './node';
import { Documentation } from './documentation';

export class ParameterNode implements BaseNode {
	constructor(
		public type: TypeNode,
		public name: string,
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'parameter',
			name: this.name,
			type: this.type.toObject(),
			documentation: this.documentation?.toObject(),
		};
	}
}
