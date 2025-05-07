import { TypeNode } from '../node';
import { PropertyNode } from '../property';
import { deduplicateMemberTypes, flattenTypes, sortMemberTypes } from './compoundTypeUtils';

export class IntersectionNode implements TypeNode {
	kind = 'intersection';

	constructor(
		public name: string | undefined,
		types: TypeNode[],
		public properties: PropertyNode[],
	) {
		const flatTypes = flattenTypes(types, IntersectionNode);
		sortMemberTypes(flatTypes);
		this.types = deduplicateMemberTypes(flatTypes);
	}

	types: readonly TypeNode[];
}
