import _ from 'lodash';
import { Node, TypeNode } from './node';
import { isLiteralNode } from './literal';
import { intrinsicNode, isIntrinsicNode } from './intrinsic';
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
	sanitizeBooleanLiterals(flatTypes);
	sortUnionTypes(flatTypes);

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

function uniqueUnionTypes(node: UnionNode): UnionNode {
	// Typescript parses foo?: boolean as a union of `true | false | undefined`.
	// We want to simplify this to just `boolean | undefined`.
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

function sortUnionTypes(members: TypeNode[]) {
	// move undefined and null to the end

	const nullIndex = members.findIndex((x) => isIntrinsicNode(x) && x.type === 'null');
	members.push(members.splice(nullIndex, 1)[0]);

	const undefinedIndex = members.findIndex((x) => isIntrinsicNode(x) && x.type === 'undefined');
	members.push(members.splice(undefinedIndex, 1)[0]);
}

function sanitizeBooleanLiterals(members: TypeNode[]): void {
	const trueLiteralIndex = members.findIndex((x) => isLiteralNode(x) && x.value === 'true');
	const falseLiteralIndex = members.findIndex((x) => isLiteralNode(x) && x.value === 'false');

	if (trueLiteralIndex !== -1 && falseLiteralIndex !== -1) {
		const booleanNode = intrinsicNode('boolean');
		if (trueLiteralIndex > falseLiteralIndex) {
			members.splice(trueLiteralIndex, 1);
			members.splice(falseLiteralIndex, 1, booleanNode);
		} else {
			members.splice(falseLiteralIndex, 1);
			members.splice(trueLiteralIndex, 1, booleanNode);
		}
	}
}
