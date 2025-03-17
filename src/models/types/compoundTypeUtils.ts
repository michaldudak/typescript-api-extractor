import { uniqBy } from 'lodash';
import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { ReferenceNode } from './reference';
import { TypeNode } from '../node';
import { IntersectionNode } from './intersection';
import { UnionNode } from './union';

export function flattenTypes(
	nodes: readonly TypeNode[],
	nodeToProcess: typeof UnionNode | typeof IntersectionNode,
): TypeNode[] {
	let flatTypes: TypeNode[] = [];
	nodes.forEach((x) => {
		if (x instanceof nodeToProcess) {
			flatTypes = flatTypes.concat(flattenTypes(x.types, nodeToProcess));
		} else {
			flatTypes.push(x);
		}
	});

	return flatTypes;
}

export function deduplicateMemberTypes(types: TypeNode[]): TypeNode[] {
	return uniqBy(types, (x) => {
		if (x instanceof LiteralNode) {
			return x.value;
		}

		if (x instanceof IntrinsicNode || x instanceof ReferenceNode) {
			return x.name;
		}

		return x;
	});
}

export function sortMemberTypes(members: TypeNode[]) {
	// move undefined and null to the end

	const nullIndex = members.findIndex((x) => x instanceof IntrinsicNode && x.name === 'null');
	members.push(members.splice(nullIndex, 1)[0]);

	const undefinedIndex = members.findIndex(
		(x) => x instanceof IntrinsicNode && x.name === 'undefined',
	);
	members.push(members.splice(undefinedIndex, 1)[0]);
}
