import { Node, TypeNode } from './node';

const typeString = 'array';

export interface ArrayNode {
	nodeType: typeof typeString;
	type: TypeNode;
}

export function arrayNode(type: TypeNode): ArrayNode {
	return {
		nodeType: typeString,
		type,
	};
}

export function isArrayNode(node: Node): node is ArrayNode {
	return node.nodeType === typeString;
}
