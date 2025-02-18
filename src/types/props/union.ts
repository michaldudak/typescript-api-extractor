import _ from 'lodash';
import { Node } from '../nodes/baseNodes';
import { isLiteralNode } from './literal';
import { isInstanceOfNode } from './instanceOf';

const typeString = 'UnionNode';

export interface UnionNode extends Node {
	types: Node[];
}

export function unionNode(types: Node[]): UnionNode {
	const flatTypes: Node[] = [];

	flattenTypes(types);

	function flattenTypes(nodes: Node[]) {
		nodes.forEach((x) => {
			if (isUnionNode(x)) {
				flattenTypes(x.types);
			} else {
				flatTypes.push(x);
			}
		});
	}

	return uniqueUnionTypes({
		type: typeString,
		types: flatTypes,
	});
}

export function isUnionNode(node: Node): node is UnionNode {
	return node.type === typeString;
}

export function uniqueUnionTypes(node: UnionNode): UnionNode {
	return {
		type: node.type,
		types: _.uniqBy(node.types, (x) => {
			if (isLiteralNode(x)) {
				return x.value;
			}

			if (isInstanceOfNode(x)) {
				return `${x.type}.${x.instance}`;
			}

			return x.type;
		}),
	};
}
