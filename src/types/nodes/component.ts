import { Documentation } from '../documentation';
import { Node } from './node';
import { MemberNode } from './member';

const typeString = 'component';

export interface ComponentNode {
	nodeType: typeof typeString;
	name: string;
	props: MemberNode[];
	fileName?: string;
	description?: string;
	visibility?: Documentation['visibility'];
}

export function componentNode(
	name: string,
	props: MemberNode[],
	documentation: Documentation | undefined,
	fileName: string | undefined,
): ComponentNode {
	return {
		nodeType: typeString,
		name: name,
		props: props || [],
		description: documentation?.description,
		visibility: documentation?.visibility,
		fileName,
	};
}

export function isComponentNode(node: Node): node is ComponentNode {
	return node.nodeType === typeString;
}
