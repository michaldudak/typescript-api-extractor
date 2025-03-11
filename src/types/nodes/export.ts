import { Documentation } from '../documentation';
import { Node, TypeNode } from './node';

const typeString = 'export';

export interface ExportNode {
	nodeType: typeof typeString;
	name: string;
	type: TypeNode;
	documentation?: Documentation;
}

export function exportNode(
	name: string,
	type: TypeNode,
	documentation: Documentation | undefined,
): ExportNode {
	return {
		nodeType: typeString,
		name,
		type,
		documentation,
	};
}

export function isExportNode(node: Node): node is ExportNode {
	return node.nodeType === typeString;
}
