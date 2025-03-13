import { TypeNode } from './node';
import { Documentation } from '../documentation';

export class ParameterNode {
	constructor(
		public type: TypeNode,
		public name: string,
		public documentation: Documentation | undefined,
	) {}
}
