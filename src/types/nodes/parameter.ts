import { Node } from './node';

const typeString = 'parameter';

export interface ParameterNode {
	nodeType: typeof typeString;
	type: Node;
}

export function parameterNode(type: Node): ParameterNode {
	return {
		nodeType: typeString,
		type,
	};
}

export function isParameterNode(node: Node): node is ParameterNode {
	return node.nodeType === typeString;
}
