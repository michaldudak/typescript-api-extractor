import { Node, TypeNode } from './node';
import { ParameterNode } from './parameter';

const typeString = 'function';

export interface FunctionNode {
	nodeType: typeof typeString;
	callSignatures?: CallSignature[];
}

export interface CallSignature {
	parameters: ParameterNode[];
	returnValueType: TypeNode;
}

export function functionNode(callSignatures: CallSignature[]): FunctionNode {
	return {
		nodeType: typeString,
		callSignatures,
	};
}

export function isFunctionNode(node: Node): node is FunctionNode {
	return node.nodeType === typeString;
}
