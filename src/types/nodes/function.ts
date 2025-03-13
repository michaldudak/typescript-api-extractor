import { TypeNode } from './node';
import { ParameterNode } from './parameter';

export class FunctionNode {
	constructor(
		name: string | undefined,
		public callSignatures: CallSignature[],
	) {
		this.name = name === '__function' ? undefined : name;
	}

	name: string | undefined;
}

export interface CallSignature {
	parameters: ParameterNode[];
	returnValueType: TypeNode;
}
