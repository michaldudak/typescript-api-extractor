import { Documentation } from '../documentation';
import { TypeNode } from '../node';

export class FunctionNode implements TypeNode {
	kind = 'function';
	name: string | undefined;

	constructor(
		name: string | undefined,
		public parentNamespaces: string[],
		public callSignatures: CallSignature[],
	) {
		this.name = name === '__function' ? undefined : name;
	}
}

export class CallSignature {
	constructor(
		public parameters: Parameter[],
		public returnValueType: TypeNode,
	) {}
}

export class Parameter {
	constructor(
		public type: TypeNode,
		public name: string,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public defaultValue: unknown | undefined,
	) {}
}
