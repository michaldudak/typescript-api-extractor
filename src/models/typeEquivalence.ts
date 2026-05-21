import { ArrayNode } from './types/array';
import { ExternalTypeNode } from './types/external';
import { FunctionNode } from './types/function';
import { IntrinsicNode } from './types/intrinsic';
import { ObjectNode } from './types/object';
import { TupleNode } from './types/tuple';
import { TypeParameterNode } from './types/typeParameter';
import { type AnyType } from './node';

// UnionNode and IntersectionNode are matched by `kind` rather than `instanceof`:
// they construct themselves through typeCanonicalizer, which imports this module,
// so importing them here would form a module-initialization cycle.

type TypeParameterRenameMap = ReadonlyMap<string, string>;
type EquivalentTypeName = {
	name: string;
	namespaces?: readonly string[];
	typeArguments?: readonly { type: AnyType }[];
};

/**
 * Compares model types structurally for canonicalization. The visitor treats
 * unaliased `any` as a wildcard, which lets generated overload unions prefer a
 * concrete signature over a duplicate fallback signature containing `any`.
 */
class TypeEquivalence {
	areEquivalentIgnoringAny(
		type1: AnyType,
		type2: AnyType,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		// If either side is an unaliased `any` (no typeName), it matches any type.
		const type1IsAny = type1 instanceof IntrinsicNode && type1.intrinsic === 'any';
		const type2IsAny = type2 instanceof IntrinsicNode && type2.intrinsic === 'any';
		const type1IsUnaliasedAny = type1IsAny && !type1.typeName;
		const type2IsUnaliasedAny = type2IsAny && !type2.typeName;
		if (type1IsUnaliasedAny || type2IsUnaliasedAny) {
			return true;
		}

		// Type parameters compare by identity, with scoped alpha-renames applied
		// for equivalent function signatures such as `<T>(value: T)` and
		// `<U>(value: U)`.
		if (type1 instanceof TypeParameterNode && type2 instanceof TypeParameterNode) {
			const name2Renamed = typeParamRenames?.get(type2.name) ?? type2.name;
			return type1.name === name2Renamed;
		}

		// A type parameter named "string" must not match the intrinsic `string`.
		if (type1 instanceof TypeParameterNode || type2 instanceof TypeParameterNode) {
			return false;
		}

		// Fast-path simple non-function types when no rename context is active.
		// FunctionNode is excluded because TypeParameterNode.toString() omits
		// constraints/defaults, which would collapse distinct generic signatures.
		if (!typeParamRenames || typeParamRenames.size === 0) {
			if (
				!(type1 instanceof FunctionNode) &&
				!(type2 instanceof FunctionNode) &&
				type1.toString() === type2.toString()
			) {
				return true;
			}
		}

		// Alias identity wins over shape. Two aliases with equal names and type
		// arguments match; aliased and inline forms intentionally do not.
		const tn1 = 'typeName' in type1 ? type1.typeName : undefined;
		const tn2 = 'typeName' in type2 ? type2.typeName : undefined;
		if (tn1 || tn2) {
			if (tn1 && tn2) {
				return this.typeNamesAreEquivalentIgnoringAny(tn1, tn2, typeParamRenames);
			}
			return false;
		}

		if (type1 instanceof FunctionNode && type2 instanceof FunctionNode) {
			return this.areFunctionsEquivalentIgnoringAny(type1, type2, typeParamRenames);
		}

		if (type1.kind === 'union' && type2.kind === 'union') {
			return this.membersAreEquivalentUnordered(type1.types, type2.types, typeParamRenames);
		}

		if (type1.kind === 'intersection' && type2.kind === 'intersection') {
			return this.membersAreEquivalentUnordered(type1.types, type2.types, typeParamRenames);
		}

		if (type1 instanceof ArrayNode && type2 instanceof ArrayNode) {
			return this.areEquivalentIgnoringAny(type1.elementType, type2.elementType, typeParamRenames);
		}

		if (type1 instanceof TupleNode && type2 instanceof TupleNode) {
			if (type1.types.length !== type2.types.length) {
				return false;
			}
			return type1.types.every((t1, index) =>
				this.areEquivalentIgnoringAny(t1, type2.types[index], typeParamRenames),
			);
		}

		if (type1 instanceof ExternalTypeNode && type2 instanceof ExternalTypeNode) {
			return this.typeNamesAreEquivalentIgnoringAny(
				type1.typeName,
				type2.typeName,
				typeParamRenames,
			);
		}

		if (type1 instanceof ObjectNode && type2 instanceof ObjectNode) {
			return this.objectTypesAreEquivalentIgnoringAny(type1, type2, typeParamRenames);
		}

		// Leaf model nodes that do not contain nested type parameters can safely
		// fall back to their rendering identity.
		return type1.toString() === type2.toString();
	}

	/**
	 * Compares function signatures, including generic constraints/defaults.
	 * Handles examples like `<T>(value: T) => T` and `<U>(value: U) => U` as
	 * equivalent while rejecting different aliases or parameter optionality.
	 */
	areFunctionsEquivalentIgnoringAny(
		func1: FunctionNode,
		func2: FunctionNode,
		outerTypeParamRenames?: TypeParameterRenameMap,
	): boolean {
		const typeName1 = func1.typeName;
		const typeName2 = func2.typeName;
		if (Boolean(typeName1) !== Boolean(typeName2)) {
			return false;
		}
		if (
			typeName1 &&
			typeName2 &&
			!this.typeNamesAreEquivalentIgnoringAny(typeName1, typeName2, outerTypeParamRenames)
		) {
			return false;
		}

		if (func1.callSignatures.length !== func2.callSignatures.length) {
			return false;
		}

		for (let i = 0; i < func1.callSignatures.length; i++) {
			const sig1 = func1.callSignatures[i];
			const sig2 = func2.callSignatures[i];

			const typeParamRenames = this.buildSignatureTypeParameterRenames(
				sig1.typeParameters ?? [],
				sig2.typeParameters ?? [],
				outerTypeParamRenames,
			);
			if (!typeParamRenames) {
				return false;
			}

			const tp1 = sig1.typeParameters ?? [];
			const tp2 = sig2.typeParameters ?? [];
			for (let k = 0; k < tp1.length; k++) {
				const c1 = tp1[k].constraint;
				const c2 = tp2[k].constraint;
				if (c1 && c2) {
					if (!this.areEquivalentIgnoringAny(c1, c2, typeParamRenames)) {
						return false;
					}
				} else if (c1 || c2) {
					return false;
				}

				const d1 = tp1[k].defaultValue;
				const d2 = tp2[k].defaultValue;
				if (d1 && d2) {
					if (!this.areEquivalentIgnoringAny(d1, d2, typeParamRenames)) {
						return false;
					}
				} else if (d1 || d2) {
					return false;
				}
			}

			if (sig1.parameters.length !== sig2.parameters.length) {
				return false;
			}

			if (
				!this.areEquivalentIgnoringAny(sig1.returnValueType, sig2.returnValueType, typeParamRenames)
			) {
				return false;
			}

			for (let j = 0; j < sig1.parameters.length; j++) {
				const param1 = sig1.parameters[j];
				const param2 = sig2.parameters[j];

				if (param1.name !== param2.name || param1.optional !== param2.optional) {
					return false;
				}

				if (!this.areEquivalentIgnoringAny(param1.type, param2.type, typeParamRenames)) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Detects whether a type contains `any` directly or in nested signatures,
	 * members, properties, constraints, or default type parameters.
	 */
	containsAny(type: AnyType): boolean {
		if (type instanceof IntrinsicNode && type.intrinsic === 'any') {
			return true;
		}

		if (type instanceof FunctionNode) {
			return type.callSignatures.some(
				(signature) =>
					signature.parameters.some((parameter) => this.containsAny(parameter.type)) ||
					this.containsAny(signature.returnValueType) ||
					(signature.typeParameters ?? []).some(
						(typeParameter) =>
							(typeParameter.constraint != null && this.containsAny(typeParameter.constraint)) ||
							(typeParameter.defaultValue != null && this.containsAny(typeParameter.defaultValue)),
					),
			);
		}

		if (type.kind === 'union' || type.kind === 'intersection') {
			return type.types.some((member) => this.containsAny(member));
		}

		if (type instanceof ArrayNode) {
			return this.containsAny(type.elementType);
		}

		if (type instanceof TupleNode) {
			return type.types.some((member) => this.containsAny(member));
		}

		if (type instanceof ObjectNode) {
			return (
				type.properties.some((property) => this.containsAny(property.type)) ||
				(type.indexSignature?.valueType != null && this.containsAny(type.indexSignature.valueType))
			);
		}

		if (type instanceof ExternalTypeNode) {
			const args = type.typeName.typeArguments;
			return args != null && args.some((arg) => this.containsAny(arg.type));
		}

		return false;
	}

	private typeNamesAreEquivalentIgnoringAny(
		typeName1: EquivalentTypeName,
		typeName2: EquivalentTypeName,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		if (typeName1.name !== typeName2.name) {
			return false;
		}

		const namespaces1 = typeName1.namespaces ?? [];
		const namespaces2 = typeName2.namespaces ?? [];
		if (
			namespaces1.length !== namespaces2.length ||
			namespaces1.some((namespace, index) => namespace !== namespaces2[index])
		) {
			return false;
		}

		const args1 = typeName1.typeArguments ?? [];
		const args2 = typeName2.typeArguments ?? [];
		if (args1.length !== args2.length) {
			return false;
		}

		return args1.every((arg, index) =>
			this.areEquivalentIgnoringAny(arg.type, args2[index].type, typeParamRenames),
		);
	}

	private membersAreEquivalentUnordered(
		types1: readonly AnyType[],
		types2: readonly AnyType[],
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		const n = types1.length;
		if (n !== types2.length) {
			return false;
		}
		if (n === 0) {
			return true;
		}

		// Use a cheap key multiset pre-check before the O(n^3) bipartite match,
		// but skip it when wildcard `any` or rename maps would make keys unsafe.
		const hasAnyWildcard = [...types1, ...types2].some(
			(type) => type instanceof IntrinsicNode && type.intrinsic === 'any' && !type.typeName,
		);
		const hasTypeParamRenames = typeParamRenames != null && typeParamRenames.size > 0;
		if (!hasAnyWildcard && !hasTypeParamRenames) {
			if (!this.structuralKeyMultisetsMatch(types1, types2)) {
				return false;
			}
		}

		const adjacency: number[][] = [];
		for (let j = 0; j < n; j++) {
			adjacency[j] = [];
			for (let i = 0; i < n; i++) {
				if (this.areEquivalentIgnoringAny(types1[j], types2[i], typeParamRenames)) {
					adjacency[j].push(i);
				}
			}
		}

		const match2 = new Array<number>(n).fill(-1);
		const tryAugment = (j: number, visited: boolean[]): boolean => {
			for (const i of adjacency[j]) {
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
		};

		for (let j = 0; j < n; j++) {
			if (!tryAugment(j, new Array<boolean>(n).fill(false))) {
				return false;
			}
		}

		return true;
	}

	private objectTypesAreEquivalentIgnoringAny(
		type1: ObjectNode,
		type2: ObjectNode,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		if (type1.properties.length !== type2.properties.length) {
			return false;
		}

		const index1 = type1.indexSignature;
		const index2 = type2.indexSignature;
		if (index1 && index2) {
			if (
				index1.keyType !== index2.keyType ||
				!this.areEquivalentIgnoringAny(index1.valueType, index2.valueType, typeParamRenames)
			) {
				return false;
			}
		} else if (index1 || index2) {
			return false;
		}

		const propMap = new Map<string, (typeof type2.properties)[number]>();
		for (const property of type2.properties) {
			propMap.set(`${property.name}:${property.optional}`, property);
		}

		return type1.properties.every((property1) => {
			const property2 = propMap.get(`${property1.name}:${property1.optional}`);
			return (
				property2 != null &&
				this.areEquivalentIgnoringAny(property1.type, property2.type, typeParamRenames)
			);
		});
	}

	private buildSignatureTypeParameterRenames(
		typeParameters1: readonly { name: string }[],
		typeParameters2: readonly { name: string }[],
		outerTypeParamRenames?: TypeParameterRenameMap,
	): Map<string, string> | undefined {
		if (typeParameters1.length !== typeParameters2.length) {
			return undefined;
		}

		const typeParamRenames = new Map<string, string>(outerTypeParamRenames);
		for (let index = 0; index < typeParameters1.length; index++) {
			typeParamRenames.set(typeParameters2[index].name, typeParameters1[index].name);
		}

		return typeParamRenames;
	}

	private structuralKeyMultisetsMatch(
		types1: readonly AnyType[],
		types2: readonly AnyType[],
	): boolean {
		const keyCounts1 = this.countStructuralKeys(types1);
		const keyCounts2 = this.countStructuralKeys(types2);
		if (keyCounts1.size !== keyCounts2.size) {
			return false;
		}

		for (const [key, count1] of keyCounts1) {
			if (keyCounts2.get(key) !== count1) {
				return false;
			}
		}

		return true;
	}

	private countStructuralKeys(types: readonly AnyType[]): Map<string, number> {
		const keyCounts = new Map<string, number>();
		for (const type of types) {
			const key = this.memberStructuralKey(type);
			keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
		}
		return keyCounts;
	}

	private memberStructuralKey(type: AnyType): string {
		const kind = type.kind;
		const name = 'name' in type && type.name ? String(type.name) : '';
		const value = 'value' in type && type.value != null ? String(type.value) : '';

		if (type instanceof IntrinsicNode) {
			return `${kind}|${name}|${value}|${type.intrinsic}`;
		}

		return `${kind}|${name}|${value}`;
	}
}

export const typeEquivalenceChecker = new TypeEquivalence();
