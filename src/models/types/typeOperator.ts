import { type AnyType, type TypeNode } from '../node';
import { type TypeName } from '../typeName';

export type TypeOperator = 'keyof';
export type TypeOperatorResolutionKind = 'exact' | 'baseConstraint' | 'fallback';

export class TypeOperatorNode implements TypeNode {
	readonly kind = 'typeOperator';
	readonly typeName: TypeName | undefined;

	constructor(
		typeName: TypeName | undefined,
		readonly operator: TypeOperator,
		readonly type: AnyType,
		readonly resolvedType: AnyType,
		readonly resolutionKind: TypeOperatorResolutionKind = 'exact',
	) {
		this.typeName = typeName?.name ? typeName : undefined;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		const renderedType = this.type.toString();
		const operand = this.type.kind === 'function' ? `(${renderedType})` : renderedType;
		return `${this.operator} ${operand}`;
	}
}
