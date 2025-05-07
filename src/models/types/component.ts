import { PropertyNode } from '../property';
import { TypeNode } from '../node';

export class ComponentNode implements TypeNode {
	kind = 'component';

	constructor(
		public name: string | undefined,
		public props: PropertyNode[],
	) {}
}
