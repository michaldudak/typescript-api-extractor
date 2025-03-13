import { TypeNode } from './node';

export class TypeParameterNode {
	constructor(
		public name: string,
		public constraint: string | undefined,
		public defaultValue: TypeNode | undefined,
	) {}
}
