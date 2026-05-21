import { TypeNode } from '../node';
import { TypeName } from '../typeName';

export class ExternalTypeNode implements TypeNode {
	readonly kind = 'external';
	typeName: TypeName;

	constructor(typeName: TypeName) {
		this.typeName = typeName;
	}

	toString(): string {
		return this.typeName.toString();
	}
}
