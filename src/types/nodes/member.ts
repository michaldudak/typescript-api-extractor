import { Documentation } from '../documentation';
import { Node, TypeNode } from './node';

const typeString = 'member';

export interface MemberNode {
	nodeType: typeof typeString;
	name: string;
	type: TypeNode;
	documentation?: Documentation;
	optional: boolean;
	filenames: Set<string>;
	/**
	 * @internal
	 */
	$$id: number | undefined;
}

export function memberNode(
	name: string,
	type: TypeNode,
	documentation: Documentation | undefined,
	optional: boolean,
	filenames: Set<string>,
	id: number | undefined,
): MemberNode {
	return {
		nodeType: typeString,
		name,
		type,
		documentation,
		optional,
		filenames,
		$$id: id,
	};
}

export function isMemberNode(node: Node): node is MemberNode {
	return node.nodeType === typeString;
}
