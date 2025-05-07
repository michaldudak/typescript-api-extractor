import { TypeNode } from '../node';
import { Documentation } from '../documentation';

export class LiteralNode implements TypeNode {
	kind = 'literal';
	name: undefined;
	parentNamespaces: string[] = [];

	constructor(
		public value: unknown,
		public documentation?: Documentation,
	) {}
}
