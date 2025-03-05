import { Node } from './node';
import { ComponentNode } from './component';
import { HookNode } from './hook';
import { FunctionNode } from './function';
import { EnumNode } from './enum';

const typeString = 'program';

export interface ProgramNode {
	nodeType: typeof typeString;
	body: (ComponentNode | HookNode | FunctionNode | EnumNode)[];
}

export function programNode(
	body?: (ComponentNode | HookNode | FunctionNode | EnumNode)[],
): ProgramNode {
	return {
		nodeType: typeString,
		body: body || [],
	};
}

export function isProgramNode(node: Node): node is ProgramNode {
	return node.nodeType === typeString;
}
