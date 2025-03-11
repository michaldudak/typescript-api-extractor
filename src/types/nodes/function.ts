import { Node, TypeNode } from './node';
import { ParameterNode } from './parameter';

const typeString = 'function';

export interface FunctionNode {
	nodeType: typeof typeString;
	name: string | undefined;
	callSignatures: CallSignature[];
}

export function functionNode(
	name: string | undefined,
	callSignatures: CallSignature[],
): FunctionNode {
	return {
		nodeType: typeString,
		name: name === '__function' ? undefined : name,
		callSignatures,
	};
}

export function isFunctionNode(node: Node): node is FunctionNode {
	return node.nodeType === typeString;
}

export interface CallSignature {
	parameters: ParameterNode[];
	returnValueType: TypeNode;
}
