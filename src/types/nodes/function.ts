import { Documentation } from '../documentation';
import { Node, TypeNode } from './node';
import { ParameterNode } from './parameter';

const typeString = 'function';

export interface FunctionNode {
	nodeType: typeof typeString;
	name: string;
	callSignatures: CallSignature[];
	documentation: Documentation | undefined;
}

export interface CallSignature {
	parameters: ParameterNode[];
	returnValueType: TypeNode;
}

export function functionNode(
	name: string,
	callSignatures: CallSignature[],
	documentation: Documentation | undefined,
): FunctionNode {
	return {
		nodeType: typeString,
		name,
		callSignatures,
		documentation,
	};
}

export function isFunctionNode(node: Node): node is FunctionNode {
	return node.nodeType === typeString;
}
