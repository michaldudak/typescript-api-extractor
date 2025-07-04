import { TypeNode } from '../node';
import { Documentation } from '../documentation';
import { PropertyNode } from '../property';
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
}
