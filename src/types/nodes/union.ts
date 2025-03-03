import _ from 'lodash';
import { Node, TypeNode } from './node';
import { isLiteralNode } from './literal';
import { isIntrinsicNode } from './intrinsic';
import { isReferenceNode } from './reference';
import { isInterfaceNode } from './interface';

const typeString = 'union';

export interface UnionNode {
	nodeType: typeof typeString;
	types: TypeNode[];
}

export function unionNode(types: TypeNode[]): UnionNode {
	const flatTypes: TypeNode[] = [];

	flattenTypes(types);

	function flattenTypes(nodes: TypeNode[]) {
		nodes.forEach((x) => {
			if (isUnionNode(x)) {
				flattenTypes(x.types);
			} else {
				flatTypes.push(x);
			}
		});
	}

	return uniqueUnionTypes({
		nodeType: typeString,
		types: flatTypes,
	});
}

export function isUnionNode(node: Node): node is UnionNode {
	return node.nodeType === typeString;
}

export function uniqueUnionTypes(node: UnionNode): UnionNode {
	return {
		nodeType: node.nodeType,
		types: _.uniqBy(node.types, (x) => {
			if (isLiteralNode(x)) {
				return x.value;
			}

			if (isIntrinsicNode(x)) {
				return x.type;
			}

			if (isReferenceNode(x)) {
				return x.typeName;
			}

			if (isInterfaceNode(x)) {
				return x;
			}

			return x.nodeType;
		}),
	};
}
