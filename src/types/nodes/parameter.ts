import { Documentation } from '../documentation';
import { Node, TypeNode } from './node';

const typeString = 'parameter';

export interface ParameterNode {
	nodeType: typeof typeString;
	name: string;
	type: TypeNode;
	documentation: Documentation | undefined;
}

export function parameterNode(
	type: TypeNode,
	name: string,
	documentation: Documentation | undefined,
): ParameterNode {
	return {
		nodeType: typeString,
		name,
		type,
		documentation,
	};
}

export function isParameterNode(node: Node): node is ParameterNode {
	return node.nodeType === typeString;
}
