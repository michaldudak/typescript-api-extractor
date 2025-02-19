import { Node } from '../nodes/baseNodes';

const typeString = 'simpleType';

interface SimpleTypeNode extends Node {
	typeName: string;
}

export function simpleTypeNode(typeName: string): SimpleTypeNode {
	return {
		nodeType: typeString,
		typeName,
	};
}

export function isSimpleTypeNode(node: Node): node is SimpleTypeNode {
	return node.nodeType === typeString;
}
