import { Node } from './node';

const typeString = 'object';

export interface ObjectNode {
	nodeType: typeof typeString;
}

export function objectNode(): ObjectNode {
	return {
		nodeType: typeString,
	};
}

export function isObjectNode(node: Node): node is ObjectNode {
	return node.nodeType === typeString;
}
