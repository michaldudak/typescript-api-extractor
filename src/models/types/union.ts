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
		sanitizeNeverMembers(flatTypes);
		sortMemberTypes(flatTypes);
		this.types = deduplicateMemberTypes(flatTypes);
		this.typeName = name;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return '(' + this.types.map((type) => type.toString()).join(' | ') + ')';
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

/**
 * `never` in a union is redundant when other members are present.
 * Preserve standalone `never` and aliased `never` (with typeName).
 */
function sanitizeNeverMembers(members: AnyType[]): void {
	if (members.length <= 1) {
		return;
	}

	const hasNonRedundantMember = members.some(
		(member) =>
			!(member instanceof IntrinsicNode && member.intrinsic === 'never' && !member.typeName),
	);

	if (!hasNonRedundantMember) {
		return;
	}

	for (let i = members.length - 1; i >= 0; i--) {
		const member = members[i];
		if (member instanceof IntrinsicNode && member.intrinsic === 'never' && !member.typeName) {
			members.splice(i, 1);
		}
	}
}
