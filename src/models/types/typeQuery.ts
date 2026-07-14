import { type TypeNode } from '../node';
import { type TypeName } from '../typeName';

export class TypeQueryNode implements TypeNode {
	readonly kind = 'typeQuery';
	readonly typeName: TypeName | undefined = undefined;

	constructor(readonly expressionName: string) {}

	toString(): string {
		return `typeof ${this.expressionName}`;
	}
}
