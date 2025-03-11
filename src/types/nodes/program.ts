import { Node } from './node';
import { ModuleNode } from './module';

const typeString = 'program';

export interface ProgramNode {
	nodeType: typeof typeString;
	modules: ModuleNode[];
}

export function programNode(modules: ModuleNode[] = []): ProgramNode {
	return {
		nodeType: typeString,
		modules,
	};
}

export function isProgramNode(node: Node): node is ProgramNode {
	return node.nodeType === typeString;
}
