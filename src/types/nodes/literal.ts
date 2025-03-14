import { Documentation } from '../documentation';
import { BaseNode } from './node';

export class LiteralNode implements BaseNode {
	constructor(
		public value: unknown,
		public documentation?: Documentation,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'literal',
			value: this.value,
			documentation: this.documentation?.toObject(),
		};
	}
}
