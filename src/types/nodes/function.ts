import { Node, TypeNode } from './node';

const typeString = 'function';

export interface FunctionNode {
	nodeType: typeof typeString;
	parameters: Node[];
	returnValueType: TypeNode;
}

export function functionNode(parameters: Node[], returnValueType: TypeNode): FunctionNode {
	return {
		nodeType: typeString,
		parameters,
		returnValueType,
	};
}

export function isFunctionNode(node: Node): node is FunctionNode {
	return node.nodeType === typeString;
}
