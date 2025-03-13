import { uniqBy } from 'lodash';
import { TypeNode } from './node';
import { LiteralNode } from './literal';
import { IntrinsicNode } from './intrinsic';
import { ReferenceNode } from './reference';

export class UnionNode {
	constructor(
		public name: string | undefined,
		types: TypeNode[],
	) {
		const flatTypes: TypeNode[] = [];

		flattenTypes(types);
		sanitizeBooleanLiterals(flatTypes);
		sortUnionTypes(flatTypes);

		function flattenTypes(nodes: readonly TypeNode[]) {
			nodes.forEach((x) => {
				if (x instanceof UnionNode) {
					flattenTypes(x.types);
				} else {
					flatTypes.push(x);
				}
			});
		}

		this.types = uniqueUnionTypes(flatTypes);
	}

	types: readonly TypeNode[];
}

function uniqueUnionTypes(types: TypeNode[]): TypeNode[] {
	return uniqBy(types, (x) => {
		if (x instanceof LiteralNode) {
			return x.value;
		}

		if (x instanceof IntrinsicNode) {
			return x.type;
		}

		if (x instanceof ReferenceNode) {
			return x.typeName;
		}

		return x;
	});
}

function sortUnionTypes(members: TypeNode[]) {
	// move undefined and null to the end

	const nullIndex = members.findIndex((x) => x instanceof IntrinsicNode && x.type === 'null');
	members.push(members.splice(nullIndex, 1)[0]);

	const undefinedIndex = members.findIndex(
		(x) => x instanceof IntrinsicNode && x.type === 'undefined',
	);
	members.push(members.splice(undefinedIndex, 1)[0]);
}

/**
 * Typescript parses foo?: boolean as a union of `true | false | undefined`.
 * We want to simplify this to just `boolean | undefined`.
 */
function sanitizeBooleanLiterals(members: TypeNode[]): void {
	const trueLiteralIndex = members.findIndex((x) => x instanceof LiteralNode && x.value === 'true');
	const falseLiteralIndex = members.findIndex(
		(x) => x instanceof LiteralNode && x.value === 'false',
	);

	if (trueLiteralIndex !== -1 && falseLiteralIndex !== -1) {
		const booleanNode = new IntrinsicNode('boolean');
		if (trueLiteralIndex > falseLiteralIndex) {
			members.splice(trueLiteralIndex, 1);
			members.splice(falseLiteralIndex, 1, booleanNode);
		} else {
			members.splice(falseLiteralIndex, 1);
			members.splice(trueLiteralIndex, 1, booleanNode);
		}
	}
}
