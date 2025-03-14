import { TypeNode } from '../node';
import { Documentation } from '../documentation';

export class LiteralNode implements TypeNode {
	kind = 'literal';
	name: undefined;

	constructor(
		public value: unknown,
		public documentation?: Documentation,
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			value: this.value,
			documentation: this.documentation?.toObject(),
		};
	}
}
