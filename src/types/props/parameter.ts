import { Node } from '../nodes/baseNodes';

const typeString = 'ParameterNode';

interface ParameterNode extends Node {
	name: string;
	parameterType: string;
}

export function parameterNode(name: string, parameterType: string): ParameterNode {
	return {
		type: typeString,
		name,
		parameterType,
	};
}

export function isParameterNode(node: Node) {
	return node.type === typeString;
}
