import { Node } from '../nodes/baseNodes';

const typeString = 'function';

export interface FunctionNode extends Node {
	parameters: Node[];
	returnValue: Node;
}

export function functionNode(parameters: Node[], returnValue: Node): FunctionNode {
	return {
		nodeType: typeString,
		parameters,
		returnValue,
	};
}

export function isFunctionNode(node: Node) {
	return node.nodeType === typeString;
}
