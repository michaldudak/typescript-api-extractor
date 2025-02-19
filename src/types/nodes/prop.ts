import { Node } from './baseNodes';

const typeString = 'PropNode';

export interface PropNode extends Node {
	name: string;
	jsDoc?: string;
	propType: Node;
	optional: boolean;
	filenames: Set<string>;
	/**
	 * @internal
	 */
	$$id: number | undefined;
}

export function propNode(
	name: string,
	jsDoc: string | undefined,
	propType: Node,
	optional: boolean,
	filenames: Set<string>,
	id: number | undefined,
): PropNode {
	return {
		type: typeString,
		name,
		jsDoc,
		propType,
		optional,
		filenames,
		$$id: id,
	};
}

export function isPropNode(node: Node): node is PropNode {
	return node.type === typeString;
}
