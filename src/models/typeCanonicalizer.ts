import { type AnyType } from './node';
import { typeEquivalenceChecker } from './typeEquivalence';
import { FunctionNode } from './types/function';
import { IntersectionNode } from './types/intersection';
import { IntrinsicNode } from './types/intrinsic';
import { LiteralNode } from './types/literal';
import { ExternalTypeNode } from './types/external';
import { TypeParameterNode } from './types/typeParameter';
import { UnionNode } from './types/union';

type CompoundNodeConstructor = typeof UnionNode | typeof IntersectionNode;

/**
 * Normalizes compound type members before they are placed in a model DTO.
 * Handles examples like `(A | B) | undefined`, `true | false`, and duplicate
 * overload signatures that differ only by `any` fallback members.
 */
class TypeCanonicalizer {
	canonicalizeUnionMembers(types: readonly AnyType[]): AnyType[] {
		const flatTypes = this.flattenTypes(types, UnionNode);
		this.sanitizeBooleanLiterals(flatTypes);
		this.sanitizeNeverMembers(flatTypes);
		this.sortMemberTypes(flatTypes);
		return this.deduplicateMemberTypes(flatTypes);
	}

	canonicalizeIntersectionMembers(types: readonly AnyType[]): AnyType[] {
		const flatTypes = this.flattenTypes(types, IntersectionNode);
		this.sortMemberTypes(flatTypes);
		return this.deduplicateMemberTypes(flatTypes);
	}

	/**
	 * Flattens nested, unaliased compound nodes. Aliased compounds are preserved
	 * because their TypeName is part of the public API identity.
	 */
	flattenTypes(nodes: readonly AnyType[], nodeToProcess: CompoundNodeConstructor): AnyType[] {
		let flatTypes: AnyType[] = [];
		nodes.forEach((node) => {
			if (node instanceof nodeToProcess && !node.typeName) {
				flatTypes = flatTypes.concat(this.flattenTypes(node.types, nodeToProcess));
			} else {
				flatTypes.push(node);
			}
		});

		return flatTypes;
	}

	/**
	 * Removes structurally duplicate members while preserving original order.
	 * Function members use the equivalence checker so concrete overload
	 * signatures win over otherwise identical signatures containing `any`
	 * fallbacks.
	 */
	deduplicateMemberTypes(types: readonly AnyType[]): AnyType[] {
		const functionTypes: { index: number; func: FunctionNode }[] = [];
		const nonFunctionTypes: { index: number; type: AnyType }[] = [];

		for (let i = 0; i < types.length; i++) {
			const type = types[i];
			if (type instanceof FunctionNode) {
				functionTypes.push({ index: i, func: type });
			} else {
				nonFunctionTypes.push({ index: i, type });
			}
		}

		const deduplicatedFunctions: { index: number; func: FunctionNode }[] = [];
		for (const { index, func } of functionTypes) {
			const existingIndex = deduplicatedFunctions.findIndex((existing) =>
				typeEquivalenceChecker.areFunctionsEquivalentIgnoringAny(existing.func, func),
			);

			if (existingIndex === -1) {
				deduplicatedFunctions.push({ index, func });
			} else {
				const existing = deduplicatedFunctions[existingIndex];
				if (
					typeEquivalenceChecker.containsAny(existing.func) &&
					!typeEquivalenceChecker.containsAny(func)
				) {
					deduplicatedFunctions[existingIndex] = { index: existing.index, func };
				}
			}
		}

		const seenNonFunctionKeys = new Set<unknown>();
		const deduplicatedNonFunctions: { index: number; type: AnyType }[] = [];
		for (const { index, type } of nonFunctionTypes) {
			const uniqueKey = this.getNonFunctionMemberKey(type);

			if (!seenNonFunctionKeys.has(uniqueKey)) {
				seenNonFunctionKeys.add(uniqueKey);
				deduplicatedNonFunctions.push({ index, type });
			}
		}

		const combined = [
			...deduplicatedFunctions.map((entry) => ({
				index: entry.index,
				type: entry.func as AnyType,
			})),
			...deduplicatedNonFunctions,
		];
		combined.sort((a, b) => a.index - b.index);

		return combined.map((item) => item.type);
	}

	/**
	 * Keeps `null` and `undefined` at the end of compound member lists for stable
	 * rendering while leaving authored order of the remaining members intact.
	 */
	sortMemberTypes(members: AnyType[]): void {
		const nullIndex = members.findIndex(
			(member) => member instanceof IntrinsicNode && member.intrinsic === 'null',
		);
		if (nullIndex !== -1) {
			members.push(members.splice(nullIndex, 1)[0]);
		}

		const undefinedIndex = members.findIndex(
			(member) => member instanceof IntrinsicNode && member.intrinsic === 'undefined',
		);
		if (undefinedIndex !== -1) {
			members.push(members.splice(undefinedIndex, 1)[0]);
		}
	}

	private sanitizeBooleanLiterals(members: AnyType[]): void {
		const trueLiteralIndex = members.findIndex(
			(member) => member instanceof LiteralNode && member.value === 'true',
		);
		const falseLiteralIndex = members.findIndex(
			(member) => member instanceof LiteralNode && member.value === 'false',
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

	private sanitizeNeverMembers(members: AnyType[]): void {
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

	private getNonFunctionMemberKey(type: AnyType): unknown {
		if (type instanceof LiteralNode) {
			return `literal:${type.value}`;
		}
		if (type instanceof ExternalTypeNode) {
			return `external:${type.typeName.toString()}`;
		}
		if (type instanceof TypeParameterNode) {
			return `typeparam:${type.name}`;
		}
		if (type instanceof IntrinsicNode) {
			return `intrinsic:${type.typeName?.toString() ?? type.intrinsic}`;
		}

		return type;
	}
}

export const typeCanonicalizer = new TypeCanonicalizer();
