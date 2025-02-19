import { Node } from '../nodes/baseNodes';

const typeString = 'literal';

export interface LiteralNode extends Node {
	value: unknown;
	description?: string;
}

export function literalNode(value: unknown, description?: string): LiteralNode {
	return {
		nodeType: typeString,
		value,
		description,
	};
}

export function isLiteralNode(node: Node): node is LiteralNode {
	return node.nodeType === typeString;
}
