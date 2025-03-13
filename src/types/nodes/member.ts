import { Documentation } from '../documentation';
import { TypeNode } from './node';

export class MemberNode {
	constructor(
		public name: string,
		public type: TypeNode,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public id: number | undefined,
	) {
		this.$$id = id;
	}

	public readonly $$id: number | undefined;
}
