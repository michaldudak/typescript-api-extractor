import { Node } from './node';

const typeString = 'reference';

export interface ReferenceNode {
	nodeType: typeof typeString;
	typeName: string;
}

export function referenceNode(typeName: string): ReferenceNode {
	return {
		nodeType: typeString,
		typeName,
	};
}

export function isReferenceNode(node: Node): node is ReferenceNode {
	return node.nodeType === typeString;
}
