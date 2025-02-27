import { Node } from './node';
import { MemberNode } from './member';

const typeString = 'interface';

export interface InterfaceNode {
	nodeType: typeof typeString;

	members: MemberNode[];
}

export function interfaceNode(members: MemberNode[] = []): InterfaceNode {
	return {
		nodeType: typeString,
		members,
	};
}

export function isInterfaceNode(node: Node): node is InterfaceNode {
	return node.nodeType === typeString;
}
