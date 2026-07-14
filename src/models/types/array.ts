import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';

export class ArrayNode implements TypeNode {
	readonly kind = 'array';
	public typeName: TypeName | undefined;
	public elementType: AnyType;

	constructor(
		typeName: TypeName | undefined,
		elementType: AnyType,
		public readonly isReadonly?: true,
	) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.elementType = elementType;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName?.toString();
		}

		const renderedElement = this.elementType.toString();
		const element =
			this.elementType.kind === 'typeOperator' || this.elementType.kind === 'function'
				? `(${renderedElement})`
				: renderedElement;
		return `${this.isReadonly ? 'readonly ' : ''}${element}[]`;
	}
}
