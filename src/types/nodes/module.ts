import { Node } from './node';
import { ExportNode } from './export';

const typeString = 'module';

export interface ModuleNode {
	nodeType: typeof typeString;
	name: string;
	exports: ExportNode[];
}

export function moduleNode(name: string, exports: ExportNode[]): ModuleNode {
	return {
		nodeType: typeString,
		name,
		exports,
	};
}

export function isModuleNode(node: Node): node is ModuleNode {
	return node.nodeType === typeString;
}
