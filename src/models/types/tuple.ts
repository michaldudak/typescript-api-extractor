import { TypeNode } from '../node';

export class TupleNode implements TypeNode {
	kind = 'tuple';
	constructor(
		public name: string | undefined,
		public types: TypeNode[],
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			types: this.types.map((type) => type.toObject()),
		};
	}
}
