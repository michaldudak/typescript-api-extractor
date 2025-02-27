import { Node } from './node';

const typeString = 'simpleType';

export interface SimpleTypeNode {
	nodeType: typeof typeString;
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
