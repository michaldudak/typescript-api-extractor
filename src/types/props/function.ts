import { Node } from '../nodes/baseNodes';

const typeString = 'FunctionNode';

interface FunctionNode extends Node {
	parameters: Node[];
	returnValue: Node;
}

export function functionNode(parameters: Node[], returnValue: Node): FunctionNode {
	return {
		type: typeString,
		parameters,
		returnValue,
	};
}

export function isFunctionNode(node: Node) {
	return node.type === typeString;
}
