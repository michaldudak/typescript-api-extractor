import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';

export class TupleNode implements TypeNode {
	readonly kind = 'tuple';
	public typeName: TypeName | undefined;
	public types: AnyType[];

	constructor(typeName: TypeName | undefined, types: AnyType[]) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.types = types;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return `[${this.types.map((type) => type.toString()).join(', ')}]`;
	}
}
