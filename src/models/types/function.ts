import { Documentation } from '../documentation';
import { SerializableNode, TypeNode } from '../node';

export class FunctionNode implements TypeNode {
	kind = 'function';
	name: string | undefined;

	constructor(
		name: string | undefined,
		public callSignatures: CallSignature[],
	) {
		this.name = name === '__function' ? undefined : name;
	}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
			callSignatures: this.callSignatures.map((signature) => signature.toObject()),
		};
	}
}

export class CallSignature implements SerializableNode {
	constructor(
		public parameters: Parameter[],
		public returnValueType: TypeNode,
	) {}

	toObject(): Record<string, unknown> {
		return {
			parameters: this.parameters.map((param) => param.toObject()),
			returnValueType: this.returnValueType.toObject(),
		};
	}
}

export class Parameter implements SerializableNode {
	constructor(
		public type: TypeNode,
		public name: string,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public defaultValue: unknown | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'parameter',
			name: this.name,
			type: this.type.toObject(),
			documentation: this.documentation?.toObject(),
			optional: this.optional || undefined,
			defaultValue: this.defaultValue,
		};
	}
}
