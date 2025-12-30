import { uniqBy } from 'es-toolkit';
import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { ExternalTypeNode } from './external';
import { AnyType } from '../node';
import { IntersectionNode } from './intersection';
import { UnionNode } from './union';
import { TypeParameterNode } from './typeParameter';

export function flattenTypes(
	nodes: readonly AnyType[],
	nodeToProcess: typeof UnionNode | typeof IntersectionNode,
): AnyType[] {
	let flatTypes: AnyType[] = [];
	nodes.forEach((node) => {
		if (node instanceof nodeToProcess && !node.typeName) {
			flatTypes = flatTypes.concat(flattenTypes(node.types, nodeToProcess));
		} else {
			flatTypes.push(node);
		}
	});

	return flatTypes;
}

export function deduplicateMemberTypes(types: AnyType[]): AnyType[] {
	return uniqBy(types, (x) => {
		if (x instanceof LiteralNode) {
			return x.value;
		}

		if (x instanceof ExternalTypeNode) {
			return x.typeName;
		}

		if (x instanceof TypeParameterNode) {
			return x.name;
		}

		if (x instanceof IntrinsicNode) {
			return x.typeName ?? x.intrinsic;
		}

		return x;
	});
}

export function sortMemberTypes(members: AnyType[]) {
	// move undefined and null to the end

	const nullIndex = members.findIndex((x) => x instanceof IntrinsicNode && x.intrinsic === 'null');
	if (nullIndex !== -1) {
		members.push(members.splice(nullIndex, 1)[0]);
	}

	const undefinedIndex = members.findIndex(
		(x) => x instanceof IntrinsicNode && x.intrinsic === 'undefined',
	);
	if (undefinedIndex !== -1) {
		members.push(members.splice(undefinedIndex, 1)[0]);
	}
}
