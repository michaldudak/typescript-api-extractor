import { PropertyNode } from './object';
import { TypeNode } from '../node';
import { TypeName } from '../typeName';

export class ComponentNode implements TypeNode {
	readonly kind = 'component';
	public typeName: TypeName | undefined;
	public props: PropertyNode[];

	constructor(typeName: TypeName | undefined, props: PropertyNode[]) {
		this.props = props;
		this.typeName = typeName?.name ? typeName : undefined;
	}

	toString() {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return '';
	}
}
