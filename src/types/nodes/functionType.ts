import { CallSignature } from './function';
import { Node } from './node';

const typeString = 'functionType';

export interface FunctionTypeNode {
	nodeType: typeof typeString;
	name: string | undefined;
	callSignatures: CallSignature[];
}

export function functionTypeNode(
	name: string | undefined,
	callSignatures: CallSignature[],
): FunctionTypeNode {
	return {
		nodeType: typeString,
		name,
		callSignatures,
	};
}

export function isFunctionTypeNode(node: Node): node is FunctionTypeNode {
	return node.nodeType === typeString;
}
