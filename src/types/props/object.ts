import { Node } from '../nodes/baseNodes';

const typeString = 'object';

export function objectNode(): Node {
	return {
		nodeType: typeString,
	};
}

export function isObjectNode(node: Node) {
	return node.nodeType === typeString;
}
