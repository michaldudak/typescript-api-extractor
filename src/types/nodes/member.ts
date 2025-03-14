import { Documentation } from '../documentation';
import { BaseNode, TypeNode } from './node';

export class MemberNode implements BaseNode {
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
			nodeType: 'member',
			name: this.name,
			type: this.type.toObject(),
			documentation: this.documentation?.toObject(),
			optional: this.optional,
		};
	}
}
