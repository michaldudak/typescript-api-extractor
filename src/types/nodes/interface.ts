import { Node } from './node';
import { MemberNode } from './member';

const typeString = 'interface';

export interface InterfaceNode {
	nodeType: typeof typeString;
	name: string | undefined;

	members: MemberNode[];
}

export function interfaceNode(name: string | undefined, members: MemberNode[] = []): InterfaceNode {
	return {
		nodeType: typeString,
		name,
		members,
	};
}

export function isInterfaceNode(node: Node): node is InterfaceNode {
	return node.nodeType === typeString;
}
