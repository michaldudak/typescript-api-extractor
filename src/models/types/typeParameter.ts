import { TypeNode } from '../node';

export class TypeParameterNode implements TypeNode {
	kind = 'typeParameter';

	constructor(
		public name: string,
		public parentNamespaces: string[],
		public constraint: TypeNode | undefined,
		public defaultValue: TypeNode | undefined,
	) {}
}
