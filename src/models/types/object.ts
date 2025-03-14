import { TypeNode } from '../node';
import { Documentation } from '../documentation';
import { PropertyNode } from '../property';

export class ObjectNode implements TypeNode {
	kind = 'object';

	constructor(
		public name: string | undefined,
		public properties: PropertyNode[],
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
			properties: this.properties.map((property) => property.toObject()),
			documentation: this.documentation?.toObject(),
		};
	}
}
