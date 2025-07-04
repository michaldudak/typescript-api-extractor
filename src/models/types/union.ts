import { AnyType, TypeNode } from '../node';
import { LiteralNode } from './literal';
import { IntrinsicNode } from './intrinsic';
import { deduplicateMemberTypes, flattenTypes, sortMemberTypes } from './compoundTypeUtils';
import { TypeName } from '../typeName';

export class UnionNode implements TypeNode {
	readonly kind = 'union';
	typeName: TypeName | undefined;
	types: readonly AnyType[];

	constructor(name: TypeName | undefined, types: AnyType[]) {
		const flatTypes = flattenTypes(types, UnionNode);
		sanitizeBooleanLiterals(flatTypes);
		sortMemberTypes(flatTypes);
		this.types = deduplicateMemberTypes(flatTypes);
		this.typeName = name;
	}
}

/**
 * Typescript parses foo?: boolean as a union of `true | false | undefined`.
 * We want to simplify this to just `boolean | undefined`.
 */
function sanitizeBooleanLiterals(members: AnyType[]): void {
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
