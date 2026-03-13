import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { ExternalTypeNode } from './external';
import { AnyType } from '../node';
import { IntersectionNode } from './intersection';
import { UnionNode } from './union';
import { TypeParameterNode } from './typeParameter';
import { FunctionNode } from './function';

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
 * Apply a type parameter rename map to a string, replacing occurrences
 * of renamed type parameter names using identifier-boundary matching.
 * Uses lookaround for identifier characters (word chars + $) so names
 * like $T are handled correctly.
 */
function applyTypeParamRenames(str: string, renames: ReadonlyMap<string, string>): string {
	const fromKeys = Array.from(renames.keys());
	if (fromKeys.length === 0) {
		return str;
	}

	const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	// Build a single regex that matches any of the type parameter names as whole identifiers.
	// Uses a single-pass replacement so overlapping renames (e.g., swapping T and U) don't cascade.
	const pattern = '(?<![\\w$])(' + fromKeys.map(escapeForRegex).join('|') + ')(?![\\w$])';
	const regex = new RegExp(pattern, 'g');

	return str.replace(regex, (match) => renames.get(match) ?? match);
}

/**
 * Check if two types are equivalent when ignoring `any`.
 * `any` is considered equivalent to any other type.
 * An optional type parameter rename map can be provided to treat
 * alpha-equivalent type parameters (e.g., T vs U) as identical.
 */
function typesAreEquivalentIgnoringAny(
	type1: AnyType,
	type2: AnyType,
	typeParamRenames?: ReadonlyMap<string, string>,
): boolean {
	const type1Str = type1.toString();
	let type2Str = type2.toString();

	// Apply type parameter renaming for alpha-equivalence
	if (typeParamRenames && typeParamRenames.size > 0) {
		type2Str = applyTypeParamRenames(type2Str, typeParamRenames);
	}

	// If string representations match, they're equivalent
	if (type1Str === type2Str) {
		return true;
	}

	// If one is `any`, consider them equivalent
	if (type1Str === 'any' || type2Str === 'any') {
		return true;
	}

	// If both are functions, compare them recursively
	if (type1 instanceof FunctionNode && type2 instanceof FunctionNode) {
		return functionsAreEquivalentIgnoringAny(type1, type2, typeParamRenames);
	}

	// If both are unions, compare their members
	if (type1 instanceof UnionNode && type2 instanceof UnionNode) {
		if (type1.types.length !== type2.types.length) {
			return false;
		}
		// Check if each type in union1 has an equivalent in union2
		return type1.types.every((t1, idx) =>
			typesAreEquivalentIgnoringAny(t1, type2.types[idx], typeParamRenames),
		);
	}

	// Different types
	return false;
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

		// Build rename map: sig2 type param names → sig1 type param names
		const typeParamRenames = new Map<string, string>(outerTypeParamRenames);
		for (let k = 0; k < tp1.length; k++) {
			if (tp1[k].name !== tp2[k].name) {
				typeParamRenames.set(tp2[k].name, tp1[k].name);
			}
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

	return false;
}

/**
 * Check if a function type contains `any` in its parameters (directly or nested).
 */
function functionHasAnyParams(func: FunctionNode): boolean {
	return func.callSignatures.some(
		(sig) =>
			sig.parameters.some((p) => typeContainsAny(p.type)) ||
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
			if (functionHasAnyParams(existing.func) && !functionHasAnyParams(func)) {
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
