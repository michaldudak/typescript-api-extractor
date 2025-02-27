import { Node, TypeNode } from './node';
import { ParameterNode } from './parameter';

const typeString = 'function';

export interface FunctionNode {
	nodeType: typeof typeString;
	parameters: ParameterNode[];
	returnValueType: TypeNode;
}

export function functionNode(parameters: ParameterNode[], returnValueType: TypeNode): FunctionNode {
	return {
		nodeType: typeString,
		parameters,
		returnValueType,
	};
}

export function isFunctionNode(node: Node): node is FunctionNode {
	return node.nodeType === typeString;
}
