import { Documentation } from '../documentation';
import { FunctionNode } from './function';
import { Node, TypeNode } from './node';
import { ParameterNode } from './parameter';

const typeString = 'hook';

export interface HookNode extends Omit<FunctionNode, 'nodeType'> {
	nodeType: typeof typeString;
	name: string;
	parametersFilename?: string;
	description?: string;
	visibility?: Documentation['visibility'];
}

export function hookNode(
	name: string,
	parameters: ParameterNode[],
	returnValueType: TypeNode,
	documentation: Documentation | undefined,
	parametersFilename: string | undefined,
): HookNode {
	return {
		nodeType: typeString,
		name: name,
		parameters: parameters || [],
		returnValueType,
		description: documentation?.description,
		visibility: documentation?.visibility,
		parametersFilename,
	};
}

export function isHookNode(node: Node): node is HookNode {
	return node.nodeType === typeString;
}
