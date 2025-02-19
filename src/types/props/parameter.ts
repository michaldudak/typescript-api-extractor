import { Node } from '../nodes/baseNodes';

const typeString = 'ParameterNode';

interface ParameterNode extends Node {
	name: string;
	parameterType: Node;
}

export function parameterNode(name: string, parameterType: Node): ParameterNode {
	return {
		type: typeString,
		name,
		parameterType,
	};
}

export function isParameterNode(node: Node): node is ParameterNode {
	return node.type === typeString;
}
