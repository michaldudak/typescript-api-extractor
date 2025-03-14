import { Documentation } from './documentation';
import { SerializableNode, TypeNode } from './node';

export class PropertyNode implements SerializableNode {
	constructor(
		public name: string,
		public type: TypeNode,
		public documentation: Documentation | undefined,
		public optional: boolean,
		id: number | undefined,
	) {
		this.$$id = id;
	}

	/** @internal */
	public readonly $$id: number | undefined;

	toObject(): Record<string, unknown> {
		return {
			name: this.name,
			type: this.type.toObject(),
			documentation: this.documentation?.toObject(),
			optional: this.optional,
		};
	}
}
