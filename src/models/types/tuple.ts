import { TypeNode } from '../node';

export class TupleNode implements TypeNode {
	kind = 'tuple';
	constructor(
		public name: string | undefined,
		public types: TypeNode[],
	) {}
}
