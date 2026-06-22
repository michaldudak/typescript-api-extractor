import { type AnyType, type TypeNode } from '../node';
import { type TypeName } from '../typeName';

export type TypeOperator = 'keyof';

export class TypeOperatorNode implements TypeNode {
	readonly kind = 'typeOperator';
	readonly typeName: TypeName | undefined;

	constructor(
		typeName: TypeName | undefined,
		readonly operator: TypeOperator,
		readonly type: AnyType,
		readonly resolvedType: AnyType,
	) {
		this.typeName = typeName?.name ? typeName : undefined;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return `${this.operator} ${this.type.toString()}`;
	}
}
