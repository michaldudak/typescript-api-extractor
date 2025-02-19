import { Node } from '../nodes/baseNodes';
import { PropNode } from '../nodes/prop';

const typeString = 'interface';

export interface InterfaceNode extends Node {
	types: PropNode[];
}

export function interfaceNode(types?: PropNode[]): InterfaceNode {
	return {
		nodeType: typeString,
		types: types || [],
	};
}

export function isInterfaceNode(node: Node): node is InterfaceNode {
	return node.nodeType === typeString;
}
