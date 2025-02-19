import { Documentation } from '../documentation';
import { Node } from './baseNodes';
import { PropNode } from './prop';

const typeString = 'component';

export interface ComponentNode extends Node {
	name: string;
	props: PropNode[];
	propsFilename?: string;
	description?: string;
	visibility?: Documentation['visibility'];
}

export function componentNode(
	name: string,
	props: PropNode[],
	documentation: Documentation | undefined,
	propsFilename: string | undefined,
): ComponentNode {
	return {
		nodeType: typeString,
		name: name,
		props: props || [],
		description: documentation?.description,
		visibility: documentation?.visibility,
		propsFilename,
	};
}

export function isComponentNode(node: Node): node is ComponentNode {
	return node.nodeType === typeString;
}
