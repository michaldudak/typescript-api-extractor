import { Node } from '../nodes/baseNodes';

const typeString = 'array';

export interface ArrayNode extends Node {
	arrayType: Node;
}

export function arrayNode(arrayType: Node): ArrayNode {
	return {
		nodeType: typeString,
		arrayType,
	};
}

export function isArrayNode(node: Node): node is ArrayNode {
	return node.nodeType === typeString;
}
