import { Documentation } from '../documentation';
import { FunctionNode } from '../props/function';
import { Node } from './baseNodes';

const typeString = 'hook';

export interface HookNode extends FunctionNode {
	name: string;
	parametersFilename?: string;
	description?: string;
	visibility?: Documentation['visibility'];
}

export function hookNode(
	name: string,
	parameters: Node[],
	returnValue: Node,
	documentation: Documentation | undefined,
	parametersFilename: string | undefined,
): HookNode {
	return {
		nodeType: typeString,
		name: name,
		parameters: parameters || [],
		returnValue,
		description: documentation?.description,
		visibility: documentation?.visibility,
		parametersFilename,
	};
}

export function isHookNode(node: Node): node is HookNode {
	return node.nodeType === typeString;
}
