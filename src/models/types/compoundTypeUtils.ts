import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { ExternalTypeNode } from './external';
import { AnyType } from '../node';
import { IntersectionNode } from './intersection';
import { UnionNode } from './union';
import { TypeParameterNode } from './typeParameter';
import { FunctionNode } from './function';
import { ArrayNode } from './array';
import { TupleNode } from './tuple';
import { ObjectNode } from './object';

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

/**
 * Check if two TypeName instances are equivalent, recursing into type arguments
 * with the rename map for alpha-equivalence.
 */
function typeNamesAreEquivalentIgnoringAny(
	tn1: {
		name: string;
		namespaces?: readonly string[];
		typeArguments?: readonly { type: AnyType }[];
	},
	tn2: {
		name: string;
		namespaces?: readonly string[];
		typeArguments?: readonly { type: AnyType }[];
	},
	typeParamRenames?: ReadonlyMap<string, string>,
): boolean {
	if (tn1.name !== tn2.name) {
		return false;
	}
	const ns1 = tn1.namespaces ?? [];
	const ns2 = tn2.namespaces ?? [];
	if (ns1.length !== ns2.length || ns1.some((n, i) => n !== ns2[i])) {
		return false;
	}
	const args1 = tn1.typeArguments ?? [];
	const args2 = tn2.typeArguments ?? [];
	if (args1.length !== args2.length) {
		return false;
	}
	return args1.every((a, i) =>
		typesAreEquivalentIgnoringAny(a.type, args2[i].type, typeParamRenames),
	);
}

/**
 * Produce a coarse structural key for a type member to support a cheap
 * multiset pre-check before invoking the O(n^3) bipartite matching in
 * {@link membersAreEquivalentUnordered}. This key is intentionally
 * conservative: if two members have different keys they cannot be
 * equivalent, but members with the same key may still be non-equivalent.
 * This property ensures we only ever return false earlier than before,
 * never true when the full check would fail.
 */
function memberStructuralKey(type: AnyType): string {
	const kind = type.kind;
	const name = 'name' in type && type.name ? String(type.name) : '';
	const value = 'value' in type && type.value != null ? String(type.value) : '';

	// Include the intrinsic identifier so that e.g. `string` and `number`
	// produce distinct keys instead of both collapsing to `intrinsic||`.
	if (type instanceof IntrinsicNode) {
		return `${kind}|${name}|${value}|${type.intrinsic}`;
	}

	return `${kind}|${name}|${value}`;
}

/**
 * Order-independent multiset comparison for union/intersection members.
 * Uses augmenting-path bipartite matching (Kuhn's algorithm) so that
 * wildcard `any` members don't greedily consume concrete matches needed
 * by other members. This guarantees a perfect matching is found whenever
 * one exists, regardless of member ordering.
 *
 * A cheap structural-key multiset pre-check is performed first to quickly
 * reject obviously non-equivalent member sets before paying the O(n^3)
 * matching cost.
 */
function membersAreEquivalentUnordered(
	types1: readonly AnyType[],
	types2: readonly AnyType[],
	typeParamRenames?: ReadonlyMap<string, string>,
): boolean {
	const n = types1.length;
	if (n !== types2.length) {
		return false;
	}
	if (n === 0) {
		return true;
	}

	// Cheap multiset pre-check based on per-member structural keys.
	// If the key multisets differ, the member sets cannot be equivalent.
	// Skip this pre-check when:
	// - either set contains an unaliased `any` (wildcard matches any type)
	// - a non-empty typeParamRenames map is active (keys aren't rename-aware,
	//   so e.g. T | string vs U | string with U→T would be falsely rejected)
	const hasAnyWildcard = [...types1, ...types2].some(
		(t) => t instanceof IntrinsicNode && t.intrinsic === 'any' && !t.typeName,
	);
	const hasTypeParamRenames = typeParamRenames != null && typeParamRenames.size > 0;

	if (!hasAnyWildcard && !hasTypeParamRenames) {
		const keyCounts1 = new Map<string, number>();
		for (const t of types1) {
			const key = memberStructuralKey(t);
			keyCounts1.set(key, (keyCounts1.get(key) ?? 0) + 1);
		}
		const keyCounts2 = new Map<string, number>();
		for (const t of types2) {
			const key = memberStructuralKey(t);
			keyCounts2.set(key, (keyCounts2.get(key) ?? 0) + 1);
		}
		if (keyCounts1.size !== keyCounts2.size) {
			return false;
		}
		for (const [key, count1] of keyCounts1) {
			if (keyCounts2.get(key) !== count1) {
				return false;
			}
		}
	}

	// Build adjacency list: for each types1[j], which types2[i] indices are compatible?
	const adj: number[][] = [];
	for (let j = 0; j < n; j++) {
		adj[j] = [];
		for (let i = 0; i < n; i++) {
			if (typesAreEquivalentIgnoringAny(types1[j], types2[i], typeParamRenames)) {
				adj[j].push(i);
			}
		}
	}

	// match2[i] = j means types2[i] is currently matched to types1[j], -1 = unmatched.
	const match2 = new Array<number>(n).fill(-1);

	function tryAugment(j: number, visited: boolean[]): boolean {
		for (const i of adj[j]) {
			if (visited[i]) {
				continue;
			}
			visited[i] = true;
			if (match2[i] === -1 || tryAugment(match2[i], visited)) {
				match2[i] = j;
				return true;
			}
		}
		return false;
	}

	for (let j = 0; j < n; j++) {
		if (!tryAugment(j, new Array<boolean>(n).fill(false))) {
			return false;
		}
	}

	return true;
}

/**
 * Check if two types are equivalent when ignoring `any`.
 * `any` is considered equivalent to any other type.
 * An optional type parameter rename map can be provided to treat
 * alpha-equivalent type parameters (e.g., T vs U) as identical.
 * Comparison is structural — renames are only applied to TypeParameterNode
 * identity, not to property keys or other non-type-parameter identifiers.
 */
function typesAreEquivalentIgnoringAny(
	type1: AnyType,
	type2: AnyType,
	typeParamRenames?: ReadonlyMap<string, string>,
): boolean {
	// If either side is an unaliased `any` (no typeName), it matches any type (wildcard).
	const type1IsAny = type1 instanceof IntrinsicNode && type1.intrinsic === 'any';
	const type2IsAny = type2 instanceof IntrinsicNode && type2.intrinsic === 'any';
	const type1IsUnaliasedAny = type1IsAny && !type1.typeName;
	const type2IsUnaliasedAny = type2IsAny && !type2.typeName;
	if (type1IsUnaliasedAny || type2IsUnaliasedAny) {
		return true;
	}

	// TypeParameterNode: apply rename map to compare identity
	if (type1 instanceof TypeParameterNode && type2 instanceof TypeParameterNode) {
		const name2Renamed = typeParamRenames?.get(type2.name) ?? type2.name;
		return type1.name === name2Renamed;
	}

	// If exactly one side is a TypeParameterNode, they are never equivalent.
	// A type parameter named e.g. "string" must not match the intrinsic "string".
	if (type1 instanceof TypeParameterNode || type2 instanceof TypeParameterNode) {
		return false;
	}

	// If no rename map is active, fast-path via string comparison.
	// Exclude FunctionNode because TypeParameterNode.toString() omits constraints
	// and defaults, so e.g. `<T>(...) => void` and `<T extends string>(...) => void`
	// would incorrectly stringify identically.
	if (!typeParamRenames || typeParamRenames.size === 0) {
		if (
			!(type1 instanceof FunctionNode) &&
			!(type2 instanceof FunctionNode) &&
			type1.toString() === type2.toString()
		) {
			return true;
		}
	}

	// When both types carry a typeName alias, compare by alias identity rather than
	// structural shape. Different aliases (e.g., Foo vs Bar) are distinct even if
	// their underlying structure is identical. For types with `typeName`, recurse
	// through typeNamesAreEquivalentIgnoringAny to handle type arguments properly.
	// When only one side has a typeName, they are not equivalent (aliased vs inline).
	const tn1 = 'typeName' in type1 ? type1.typeName : undefined;
	const tn2 = 'typeName' in type2 ? type2.typeName : undefined;
	if (tn1 || tn2) {
		if (tn1 && tn2) {
			return typeNamesAreEquivalentIgnoringAny(tn1, tn2, typeParamRenames);
		}
		return false;
	}

	// Functions: compare structurally
	if (type1 instanceof FunctionNode && type2 instanceof FunctionNode) {
		return functionsAreEquivalentIgnoringAny(type1, type2, typeParamRenames);
	}

	// Unions: compare members as multisets (order-independent)
	if (type1 instanceof UnionNode && type2 instanceof UnionNode) {
		return membersAreEquivalentUnordered(type1.types, type2.types, typeParamRenames);
	}

	// Intersections: compare members as multisets (order-independent)
	if (type1 instanceof IntersectionNode && type2 instanceof IntersectionNode) {
		return membersAreEquivalentUnordered(type1.types, type2.types, typeParamRenames);
	}

	// Arrays: compare element types
	if (type1 instanceof ArrayNode && type2 instanceof ArrayNode) {
		return typesAreEquivalentIgnoringAny(type1.elementType, type2.elementType, typeParamRenames);
	}

	// Tuples: compare element types
	if (type1 instanceof TupleNode && type2 instanceof TupleNode) {
		if (type1.types.length !== type2.types.length) {
			return false;
		}
		return type1.types.every((t1, idx) =>
			typesAreEquivalentIgnoringAny(t1, type2.types[idx], typeParamRenames),
		);
	}

	// ExternalTypeNode: compare name and type arguments structurally
	if (type1 instanceof ExternalTypeNode && type2 instanceof ExternalTypeNode) {
		return typeNamesAreEquivalentIgnoringAny(type1.typeName, type2.typeName, typeParamRenames);
	}

	// ObjectNode: compare properties and index signatures structurally.
	// The length check combined with the every-property-has-a-match check below
	// is sufficient because TypeScript object types have unique property names,
	// so a bijection is guaranteed when lengths match and every type1 prop maps
	// to a type2 prop.
	if (type1 instanceof ObjectNode && type2 instanceof ObjectNode) {
		if (type1.properties.length !== type2.properties.length) {
			return false;
		}
		const idx1 = type1.indexSignature;
		const idx2 = type2.indexSignature;
		if (idx1 && idx2) {
			if (
				idx1.keyType !== idx2.keyType ||
				!typesAreEquivalentIgnoringAny(idx1.valueType, idx2.valueType, typeParamRenames)
			) {
				return false;
			}
		} else if (idx1 || idx2) {
			return false;
		}
		const propMap = new Map<string, (typeof type2.properties)[number]>();
		for (const p of type2.properties) {
			propMap.set(`${p.name}:${p.optional}`, p);
		}
		return type1.properties.every((p1) => {
			const p2 = propMap.get(`${p1.name}:${p1.optional}`);
			return p2 != null && typesAreEquivalentIgnoringAny(p1.type, p2.type, typeParamRenames);
		});
	}

	// For any other types or types with typeName aliases, use toString() comparison.
	// This is safe because these types don't contain type parameter references
	// that could be confused with non-type-parameter identifiers.
	return type1.toString() === type2.toString();
}

/**
 * Check if two functions are equivalent when ignoring `any` in parameters.
 * Two functions are considered equivalent if they have the same structure
 * but differ only in that one has `any` where the other has a concrete type.
 */
function functionsAreEquivalentIgnoringAny(
	func1: FunctionNode,
	func2: FunctionNode,
	outerTypeParamRenames?: ReadonlyMap<string, string>,
): boolean {
	// Preserve alias identity: if the function type names differ, do not
	// consider the functions equivalent, even if their structures match.
	const func1HasAlias = func1.typeName !== undefined && func1.typeName !== null;
	const func2HasAlias = func2.typeName !== undefined && func2.typeName !== null;
	// Aliased vs inline function types are considered distinct.
	if (func1HasAlias !== func2HasAlias) {
		return false;
	}
	// When both are aliased, compare alias identity structurally rather than
	// by reference so that identical aliases represented by different
	// TypeName instances are treated as equivalent.
	if (
		func1HasAlias &&
		func2HasAlias &&
		!typeNamesAreEquivalentIgnoringAny(func1.typeName!, func2.typeName!, outerTypeParamRenames)
	) {
		return false;
	}

	if (func1.callSignatures.length !== func2.callSignatures.length) {
		return false;
	}

	for (let i = 0; i < func1.callSignatures.length; i++) {
		const sig1 = func1.callSignatures[i];
		const sig2 = func2.callSignatures[i];

		// Check type parameters match (count + constraints + default values)
		// Type parameter names are alpha-renamable, so we compare positionally
		// and build a rename map for use in subsequent comparisons.
		const tp1 = sig1.typeParameters ?? [];
		const tp2 = sig2.typeParameters ?? [];
		if (tp1.length !== tp2.length) {
			return false;
		}

		// Build rename map: sig2 type param names → sig1 type param names.
		// Always set the mapping for each position to shadow any stale outer
		// mapping, even when inner names match on both sides.
		const typeParamRenames = new Map<string, string>(outerTypeParamRenames);
		for (let k = 0; k < tp1.length; k++) {
			typeParamRenames.set(tp2[k].name, tp1[k].name);
		}

		for (let k = 0; k < tp1.length; k++) {
			const c1 = tp1[k].constraint;
			const c2 = tp2[k].constraint;
			if (c1 && c2) {
				if (!typesAreEquivalentIgnoringAny(c1, c2, typeParamRenames)) {
					return false;
				}
			} else if (c1 || c2) {
				// One has a constraint and the other does not: not equivalent.
				return false;
			}
			const d1 = tp1[k].defaultValue;
			const d2 = tp2[k].defaultValue;
			if (d1 && d2) {
				if (!typesAreEquivalentIgnoringAny(d1, d2, typeParamRenames)) {
					return false;
				}
			} else if (d1 || d2) {
				// One has a default and the other does not: not equivalent.
				return false;
			}
		}

		if (sig1.parameters.length !== sig2.parameters.length) {
			return false;
		}

		// Check return types match (using recursive equivalence)
		if (
			!typesAreEquivalentIgnoringAny(sig1.returnValueType, sig2.returnValueType, typeParamRenames)
		) {
			return false;
		}

		// Check each parameter
		for (let j = 0; j < sig1.parameters.length; j++) {
			const param1 = sig1.parameters[j];
			const param2 = sig2.parameters[j];

			// Names should match
			if (param1.name !== param2.name) {
				return false;
			}

			// Optionality must match
			if (param1.optional !== param2.optional) {
				return false;
			}

			// Use recursive equivalence check for parameter types
			if (!typesAreEquivalentIgnoringAny(param1.type, param2.type, typeParamRenames)) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Check if a type contains `any` (recursively).
 */
function typeContainsAny(type: AnyType): boolean {
	if (type instanceof IntrinsicNode && type.intrinsic === 'any') {
		return true;
	}

	if (type instanceof FunctionNode) {
		return type.callSignatures.some(
			(sig) =>
				sig.parameters.some((p) => typeContainsAny(p.type)) ||
				typeContainsAny(sig.returnValueType) ||
				(sig.typeParameters ?? []).some(
					(tp) =>
						(tp.constraint != null && typeContainsAny(tp.constraint)) ||
						(tp.defaultValue != null && typeContainsAny(tp.defaultValue)),
				),
		);
	}

	if (type instanceof UnionNode) {
		return type.types.some((t) => typeContainsAny(t));
	}

	if (type instanceof IntersectionNode) {
		return type.types.some((t) => typeContainsAny(t));
	}

	if (type instanceof ArrayNode) {
		return typeContainsAny(type.elementType);
	}

	if (type instanceof TupleNode) {
		return type.types.some((t) => typeContainsAny(t));
	}

	if (type instanceof ObjectNode) {
		return (
			type.properties.some((p) => typeContainsAny(p.type)) ||
			(type.indexSignature?.valueType != null && typeContainsAny(type.indexSignature.valueType))
		);
	}

	if (type instanceof ExternalTypeNode) {
		const args = type.typeName.typeArguments;
		return args != null && args.some((arg) => typeContainsAny(arg.type));
	}

	return false;
}

/**
 * Check if a function type contains `any` in its parameters, return type, or
 * type-parameter constraints/defaults (directly or nested).
 */
function functionContainsAny(func: FunctionNode): boolean {
	return func.callSignatures.some(
		(sig) =>
			sig.parameters.some((p) => typeContainsAny(p.type)) ||
			typeContainsAny(sig.returnValueType) ||
			(sig.typeParameters ?? []).some(
				(tp) =>
					(tp.constraint != null && typeContainsAny(tp.constraint)) ||
					(tp.defaultValue != null && typeContainsAny(tp.defaultValue)),
			),
	);
}

export function deduplicateMemberTypes(types: AnyType[]): AnyType[] {
	// Collect function types for special deduplication
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

	// Deduplicate functions: group equivalent ones (where `any` matches any type)
	// and prefer non-any versions
	const deduplicatedFunctions: { index: number; func: FunctionNode }[] = [];
	for (const { index, func } of functionTypes) {
		// Check if this function is equivalent to any already deduplicated function
		const existingIndex = deduplicatedFunctions.findIndex((existing) =>
			functionsAreEquivalentIgnoringAny(existing.func, func),
		);

		if (existingIndex === -1) {
			// No equivalent found, add this function
			deduplicatedFunctions.push({ index, func });
		} else {
			// Found equivalent, prefer the one without `any` params
			const existing = deduplicatedFunctions[existingIndex];
			if (functionContainsAny(existing.func) && !functionContainsAny(func)) {
				// Replace with the non-any version, but keep the earlier index
				deduplicatedFunctions[existingIndex] = { index: existing.index, func };
			}
		}
	}

	// Deduplicate non-function types by string key
	const seenNonFunctionKeys = new Set<unknown>();
	const deduplicatedNonFunctions: { index: number; type: AnyType }[] = [];
	for (const { index, type } of nonFunctionTypes) {
		let uniqueKey: unknown;
		if (type instanceof LiteralNode) {
			uniqueKey = `literal:${type.value}`;
		} else if (type instanceof ExternalTypeNode) {
			uniqueKey = `external:${type.typeName.toString()}`;
		} else if (type instanceof TypeParameterNode) {
			uniqueKey = `typeparam:${type.name}`;
		} else if (type instanceof IntrinsicNode) {
			uniqueKey = `intrinsic:${type.typeName?.toString() ?? type.intrinsic}`;
		} else {
			uniqueKey = type; // Use reference equality for other types
		}

		if (!seenNonFunctionKeys.has(uniqueKey)) {
			seenNonFunctionKeys.add(uniqueKey);
			deduplicatedNonFunctions.push({ index, type });
		}
	}

	// Combine and sort by original index to maintain order
	const combined = [
		...deduplicatedFunctions.map((f) => ({ index: f.index, type: f.func as AnyType })),
		...deduplicatedNonFunctions,
	];
	combined.sort((a, b) => a.index - b.index);

	return combined.map((item) => item.type);
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
