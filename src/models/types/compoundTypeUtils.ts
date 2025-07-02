import { uniqBy } from 'lodash';
import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { ReferenceNode } from './reference';
import { TypeNode } from '../node';
import { IntersectionNode } from './intersection';
import { UnionNode } from './union';
import { TypeParameterNode } from './typeParameter';

export function flattenTypes(
	nodes: readonly TypeNode[],
	nodeToProcess: typeof UnionNode | typeof IntersectionNode,
): TypeNode[] {
	let flatTypes: TypeNode[] = [];
	nodes.forEach((node) => {
		if (node instanceof nodeToProcess && !node.name) {
			flatTypes = flatTypes.concat(flattenTypes(node.types, nodeToProcess));
		} else {
			flatTypes.push(node);
		}
	});

	return flatTypes;
}

export function deduplicateMemberTypes(types: TypeNode[]): TypeNode[] {
	return uniqBy(types, (x) => {
		if (x instanceof LiteralNode) {
			return x.value;
		}

		if (x instanceof ReferenceNode || x instanceof TypeParameterNode) {
			return x.name;
		}

		if (x instanceof IntrinsicNode) {
			return x.name ?? x.intrinsic;
		}

		return x;
	});
}

export function sortMemberTypes(members: TypeNode[]) {
	// move undefined and null to the end

	const nullIndex = members.findIndex((x) => x instanceof IntrinsicNode && x.intrinsic === 'null');
	members.push(members.splice(nullIndex, 1)[0]);

	const undefinedIndex = members.findIndex(
		(x) => x instanceof IntrinsicNode && x.intrinsic === 'undefined',
	);
	members.push(members.splice(undefinedIndex, 1)[0]);
}
