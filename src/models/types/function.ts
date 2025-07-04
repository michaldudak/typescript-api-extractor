import { Documentation } from '../documentation';
import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';

export class FunctionNode implements TypeNode {
	readonly kind = 'function';
	typeName: TypeName | undefined;
	callSignatures: CallSignature[];

	constructor(typeName: TypeName | undefined, callSignatures: CallSignature[]) {
		this.typeName =
			typeName?.name === '__function' || typeName?.name === undefined ? undefined : typeName;
		this.callSignatures = callSignatures;
	}
}

export class CallSignature {
	constructor(
		public parameters: Parameter[],
		public returnValueType: AnyType,
	) {}
}

export class Parameter {
	constructor(
		public type: AnyType,
		public name: string,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public defaultValue: unknown | undefined,
	) {}
}
