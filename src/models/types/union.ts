import { TypeNode } from '../node';
import { LiteralNode } from './literal';
import { IntrinsicNode } from './intrinsic';
import { deduplicateMemberTypes, flattenTypes, sortMemberTypes } from './compoundTypeUtils';

export class UnionNode implements TypeNode {
	kind = 'union';

	constructor(
		public name: string | undefined,
		public parentNamespaces: string[],
		types: TypeNode[],
	) {
		const flatTypes = flattenTypes(types, UnionNode);
		sanitizeBooleanLiterals(flatTypes);
		sortMemberTypes(flatTypes);
		this.types = deduplicateMemberTypes(flatTypes);
	}

	types: readonly TypeNode[];
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
