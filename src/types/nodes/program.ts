import { Node } from './baseNodes';
import { ComponentNode } from './component';

const typeString = 'program';

export interface ProgramNode extends Node {
	body: ComponentNode[];
}

export function programNode(body?: ComponentNode[]): ProgramNode {
	return {
		nodeType: typeString,
		body: body || [],
	};
}

export function isProgramNode(node: Node): node is ProgramNode {
	return node.nodeType === typeString;
}
