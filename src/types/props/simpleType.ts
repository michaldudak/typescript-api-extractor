import { Node } from '../nodes/baseNodes';

const typeString = 'SimpleTypeNode';

interface SimpleTypeNode extends Node {
	typeName: string;
}

export function simpleTypeNode(typeName: string): SimpleTypeNode {
	return {
		type: typeString,
		typeName,
	};
}

export function isSimpleTypeNode(node: Node): node is SimpleTypeNode {
	return node.type === typeString;
}
