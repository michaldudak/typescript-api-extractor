import { Documentation } from '../documentation';
import { Node } from './baseNodes';

const typeString = 'PropNode';

export interface PropNode extends Node {
	name: string;
	description?: string;
	defaultValue?: any;
	visibility?: Documentation['visibility'];
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
	documentation: Documentation | undefined,
	propType: Node,
	optional: boolean,
	filenames: Set<string>,
	id: number | undefined,
): PropNode {
	return {
		type: typeString,
		name,
		description: documentation?.description,
		defaultValue: documentation?.defaultValue,
		visibility: documentation?.visibility,
		propType,
		optional,
		filenames,
		$$id: id,
	};
}

export function isPropNode(node: Node): node is PropNode {
	return node.type === typeString;
}
