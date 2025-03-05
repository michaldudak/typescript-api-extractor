import { Node } from './node';
import { Documentation } from '../documentation';

const typeString = 'enum';

export interface EnumNode {
	nodeType: typeof typeString;
	name: string;
	members: EnumMember[];
	documentation: Documentation | undefined;
}

export interface EnumMember {
	name: string;
	value: string;
	documentation: Documentation | undefined;
}

export function enumNode(
	name: string,
	members: EnumMember[],
	documentation: Documentation | undefined,
): EnumNode {
	return {
		nodeType: typeString,
		name,
		members,
		documentation,
	};
}

export function isEnumNode(node: Node): node is EnumNode {
	return node.nodeType === typeString;
}
