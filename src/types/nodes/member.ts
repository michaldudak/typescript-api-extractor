import { Documentation } from '../documentation';
import { Node, TypeNode } from './node';

const typeString = 'member';

export interface MemberNode {
	nodeType: typeof typeString;
	name: string;
	description?: string;
	defaultValue?: any;
	visibility?: Documentation['visibility'];
	type: TypeNode;
	optional: boolean;
	filenames: Set<string>;
	/**
	 * @internal
	 */
	$$id: number | undefined;
}

export function memberNode(
	name: string,
	documentation: Documentation | undefined,
	type: TypeNode,
	optional: boolean,
	filenames: Set<string>,
	id: number | undefined,
): MemberNode {
	return {
		nodeType: typeString,
		name,
		description: documentation?.description,
		defaultValue: documentation?.defaultValue,
		visibility: documentation?.visibility,
		type,
		optional,
		filenames,
		$$id: id,
	};
}

export function isMemberNode(node: Node): node is MemberNode {
	return node.nodeType === typeString;
}
