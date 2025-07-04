import { AnyType, TypeNode } from '../node';
import { PropertyNode } from '../property';
import { TypeName } from '../typeName';
import { deduplicateMemberTypes, flattenTypes, sortMemberTypes } from './compoundTypeUtils';

export class IntersectionNode implements TypeNode {
	readonly kind = 'intersection';
	typeName: TypeName | undefined;
	types: readonly AnyType[];
	properties: readonly PropertyNode[] = [];

	constructor(typeName: TypeName | undefined, types: AnyType[], properties: PropertyNode[]) {
		const flatTypes = flattenTypes(types, IntersectionNode);
		sortMemberTypes(flatTypes);
		this.types = deduplicateMemberTypes(flatTypes);

		this.typeName = typeName?.name ? typeName : undefined;
		this.properties = properties;
	}
}
