import { AnyType, TypeNode } from '../node';
import { Documentation } from '../documentation';
import { TypeName } from '../typeName';

export class ObjectNode implements TypeNode {
	readonly kind = 'object';
	public typeName: TypeName | undefined;
	public properties: PropertyNode[];
	public documentation: Documentation | undefined;

	constructor(
		typeName: TypeName | undefined,
		properties: PropertyNode[],
		documentation: Documentation | undefined,
	) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.properties = properties;
		this.documentation = documentation;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return `{ ${this.properties.map((p) => p.toString()).join(', ')} }`;
	}
}

export class PropertyNode {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		public optional: boolean,
	) {}

	toString(): string {
		return `${this.name}${this.optional ? '?:' : ':'} ${this.type.toString()}`;
	}
}
