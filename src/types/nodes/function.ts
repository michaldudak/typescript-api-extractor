import { BaseNode, TypeNode } from './node';
import { ParameterNode } from './parameter';

export class FunctionNode implements BaseNode {
	name: string | undefined;

	constructor(
		name: string | undefined,
		public callSignatures: CallSignature[],
	) {
		this.name = name === '__function' ? undefined : name;
	}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'function',
			name: this.name,
			callSignatures: this.callSignatures.map((signature) => signature.toObject()),
		};
	}
}

export class CallSignature implements BaseNode {
	constructor(
		public parameters: ParameterNode[],
		public returnValueType: TypeNode,
	) {}

	toObject(): Record<string, unknown> {
		return {
			parameters: this.parameters.map((param) => param.toObject()),
			returnValueType: this.returnValueType.toObject(),
		};
	}
}
