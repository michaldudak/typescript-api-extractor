import { Node } from './node';
import { ComponentNode } from './component';
import { HookNode } from './hook';

const typeString = 'program';

export interface ProgramNode {
	nodeType: typeof typeString;
	body: (ComponentNode | HookNode)[];
}

export function programNode(body?: (ComponentNode | HookNode)[]): ProgramNode {
	return {
		nodeType: typeString,
		body: body || [],
	};
}

export function isProgramNode(node: Node): node is ProgramNode {
	return node.nodeType === typeString;
}
