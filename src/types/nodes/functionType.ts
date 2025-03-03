import { CallSignature } from './function';
import { Node } from './node';

const typeString = 'functionType';

export interface FunctionTypeNode {
	nodeType: typeof typeString;
	callSignatures: CallSignature[];
}

export function functionTypeNode(callSignatures: CallSignature[]): FunctionTypeNode {
	return {
		nodeType: typeString,
		callSignatures,
	};
}

export function isFunctionTypeNode(node: Node): node is FunctionTypeNode {
	return node.nodeType === typeString;
}
