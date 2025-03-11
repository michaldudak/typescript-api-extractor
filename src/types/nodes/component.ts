import { Node } from './node';
import { MemberNode } from './member';

const typeString = 'component';

export interface ComponentNode {
	nodeType: typeof typeString;
	name: string | undefined;
	props: MemberNode[];
}

export function componentNode(name: string | undefined, props: MemberNode[]): ComponentNode {
	return {
		nodeType: typeString,
		name: name,
		props: props || [],
	};
}

export function isComponentNode(node: Node): node is ComponentNode {
	return node.nodeType === typeString;
}
