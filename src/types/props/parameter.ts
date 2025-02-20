import { Node } from '../nodes/baseNodes';

const typeString = 'parameter';

export interface ParameterNode extends Node {
	parameterType: Node;
}

export function parameterNode(parameterType: Node): ParameterNode {
	return {
		nodeType: typeString,
		parameterType,
	};
}

export function isParameterNode(node: Node): node is ParameterNode {
	return node.nodeType === typeString;
}
