import ts from 'typescript';
import { AnyType, UnionNode } from '../models';
import { resolveType } from './typeResolver';
import { ParserContext } from '../parser';
import { TypeName } from '../models/typeName';

/**
 * Checks if a type contains `any` in its structure.
 * This includes direct `any` types, array element types, and type arguments.
 */
function containsAny(checker: ts.TypeChecker, type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.Any) !== 0) {
		return true;
	}
	// Check array element type
	if (checker.isArrayType(type)) {
		const typeArgs = checker.getTypeArguments(type as ts.TypeReference);
		if (typeArgs.length > 0 && containsAny(checker, typeArgs[0])) {
			return true;
		}
	}
	// Check type arguments of generic types
	if ((type as ts.TypeReference).typeArguments) {
		for (const typeArg of (type as ts.TypeReference).typeArguments!) {
			if (containsAny(checker, typeArg)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Checks if two types are structurally equivalent, handling function types specially.
 * For function types, compares parameter types and return types recursively.
 * This is specifically designed to handle cases where generic type parameters
 * resolve to the same underlying type but TypeScript represents them differently
 * (e.g., `State` vs `Tooltip.Trigger.State` in function signatures).
 */
function areTypesEquivalent(checker: ts.TypeChecker, type1: ts.Type, type2: ts.Type): boolean {
	// Quick check: if they're the same type object, they're equivalent
	if (type1 === type2) {
		return true;
	}

	// For function types, compare structurally even if one contains `any`
	// This allows deduplicating `(value: any) => void` with `(value: ItemValue) => void`
	const sigs1 = type1.getCallSignatures();
	const sigs2 = type2.getCallSignatures();

	if (sigs1.length > 0 && sigs2.length > 0 && sigs1.length === sigs2.length) {
		// Compare each signature
		for (let i = 0; i < sigs1.length; i++) {
			const sig1 = sigs1[i];
			const sig2 = sigs2[i];

			// Compare parameter counts
			const params1 = sig1.getParameters();
			const params2 = sig2.getParameters();
			if (params1.length !== params2.length) {
				return false;
			}

			// Compare parameter types - use deep structural comparison
			for (let j = 0; j < params1.length; j++) {
				const paramType1 = checker.getTypeOfSymbol(params1[j]);
				const paramType2 = checker.getTypeOfSymbol(params2[j]);

				// If one parameter is `any`, consider them potentially equivalent
				// This allows deduplicating `(value: any) => void` with `(value: ItemValue) => void`
				const isAny1 = (paramType1.flags & ts.TypeFlags.Any) !== 0;
				const isAny2 = (paramType2.flags & ts.TypeFlags.Any) !== 0;
				if (isAny1 || isAny2) {
					continue;
				}

				// First try assignability
				if (
					checker.isTypeAssignableTo(paramType1, paramType2) &&
					checker.isTypeAssignableTo(paramType2, paramType1)
				) {
					continue;
				}

				// If assignability fails, compare structurally for object types
				// This handles cases where generic type parameters resolve to equivalent shapes
				// but TypeScript doesn't consider them assignable (e.g., State vs TooltipTrigger.State)
				if (!areObjectTypesStructurallyEquivalent(checker, paramType1, paramType2)) {
					return false;
				}
			}

			// Compare return types
			const returnType1 = sig1.getReturnType();
			const returnType2 = sig2.getReturnType();
			if (
				!checker.isTypeAssignableTo(returnType1, returnType2) ||
				!checker.isTypeAssignableTo(returnType2, returnType1)
			) {
				// Try structural comparison for return types too
				if (!areObjectTypesStructurallyEquivalent(checker, returnType1, returnType2)) {
					return false;
				}
			}
		}
		// All signatures match
		return true;
	}

	// For non-function types involving `any`, don't consider them equivalent to avoid
	// incorrectly deduplicating unions like `any[] | Group<any>[]`
	if (containsAny(checker, type1) || containsAny(checker, type2)) {
		return false;
	}

	// Check mutual assignability (handles most cases)
	if (checker.isTypeAssignableTo(type1, type2) && checker.isTypeAssignableTo(type2, type1)) {
		return true;
	}

	return false;
}

/**
 * Checks if type1 is more specific than type2.
 * A type is more specific if:
 * 1. It has non-`any` parameters while the other has `any`, OR
 * 2. It has concrete properties while the other is a type parameter, OR
 * 3. Both have the same properties but type1 has a longer/namespaced name (e.g., `Form.State` > `State`)
 * This is used to prefer namespaced types like `Tooltip.Trigger.State` over generic `State`.
 */
function isMoreSpecificType(checker: ts.TypeChecker, type1: ts.Type, type2: ts.Type): boolean {
	// For function types, compare their parameter types
	const sigs1 = type1.getCallSignatures();
	const sigs2 = type2.getCallSignatures();

	if (sigs1.length > 0 && sigs2.length > 0) {
		// Compare the first parameter of the first signature (usually the state parameter)
		const params1 = sigs1[0].getParameters();
		const params2 = sigs2[0].getParameters();

		if (params1.length > 0 && params2.length > 0) {
			const paramType1 = checker.getTypeOfSymbol(params1[0]);
			const paramType2 = checker.getTypeOfSymbol(params2[0]);

			// type1 is more specific if type2 has `any` and type1 doesn't
			const isAny1 = (paramType1.flags & ts.TypeFlags.Any) !== 0;
			const isAny2 = (paramType2.flags & ts.TypeFlags.Any) !== 0;
			if (!isAny1 && isAny2) {
				return true;
			}

			const props1 = paramType1.getProperties();
			const props2 = paramType2.getProperties();

			// type1 is more specific if it has properties while type2 doesn't
			// (type2 is likely an uninstantiated type parameter)
			if (props1.length > 0 && props2.length === 0) {
				return true;
			}

			// If both have the same number of properties (including 0),
			// prefer the one with a longer/namespaced name (e.g., `Form.State` over `State`)
			if (props1.length === props2.length) {
				const name1 = checker.typeToString(paramType1);
				const name2 = checker.typeToString(paramType2);
				// Prefer namespaced names (contain dots) or longer names
				const hasNamespace1 = name1.includes('.');
				const hasNamespace2 = name2.includes('.');
				if (hasNamespace1 && !hasNamespace2) {
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * Checks if typeNode1 is more specific than typeNode2 based on the authored text.
 * A TypeNode is more specific if it contains a namespace (e.g., `Form.State` vs `State`).
 * This is used to prefer namespaced types in the output when Types are structurally equivalent.
 */
function isTypeNodeMoreSpecific(
	typeNode1: ts.TypeNode | undefined,
	typeNode2: ts.TypeNode | undefined,
): boolean {
	if (!typeNode1 || !typeNode2) {
		return false;
	}

	const text1 = typeNode1.getText();
	const text2 = typeNode2.getText();

	// Prefer namespaced names (contain dots like `Form.State`)
	const hasNamespace1 = text1.includes('.');
	const hasNamespace2 = text2.includes('.');

	if (hasNamespace1 && !hasNamespace2) {
		return true;
	}

	return false;
}

/**
 * Compares two object types structurally by their properties.
 * This handles cases where TypeScript doesn't consider types assignable
 * but they have the same shape (e.g., generic parameters instantiated differently).
 */
function areObjectTypesStructurallyEquivalent(
	checker: ts.TypeChecker,
	type1: ts.Type,
	type2: ts.Type,
): boolean {
	// Get properties of both types
	const props1 = type1.getProperties();
	const props2 = type2.getProperties();

	// If both types have no properties, they are structurally equivalent
	// This handles empty interfaces like `interface State {}` vs aliased versions
	if (props1.length === 0 && props2.length === 0) {
		return true;
	}

	// If one type has no properties, it might be an uninstantiated type parameter
	// In that case, we can't do structural comparison, so fall back to checking
	// if the type with properties is assignable to a constraint
	if (props1.length === 0 || props2.length === 0) {
		// Check if either type is a type parameter
		const isTypeParam1 = (type1.flags & ts.TypeFlags.TypeParameter) !== 0;
		const isTypeParam2 = (type2.flags & ts.TypeFlags.TypeParameter) !== 0;

		// If one is a type parameter and the other has properties,
		// consider them potentially equivalent (the type parameter could be instantiated to match)
		if ((isTypeParam1 && props2.length > 0) || (isTypeParam2 && props1.length > 0)) {
			return true;
		}
		return false;
	}

	// Must have the same number of properties
	if (props1.length !== props2.length) {
		return false;
	}

	// Check that all properties match by name and type
	for (const prop1 of props1) {
		const prop2 = props2.find((p) => p.name === prop1.name);
		if (!prop2) {
			return false;
		}

		const propType1 = checker.getTypeOfSymbol(prop1);
		const propType2 = checker.getTypeOfSymbol(prop2);

		// Compare property types using assignability
		if (
			!checker.isTypeAssignableTo(propType1, propType2) ||
			!checker.isTypeAssignableTo(propType2, propType1)
		) {
			return false;
		}
	}

	return true;
}

export function resolveUnionType(
	type: ts.UnionType,
	typeName: TypeName | undefined,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): AnyType {
	const { checker } = context;

	let memberTypes: ts.Type[] = type.types;
	const result: AnyType[] = [];

	// @ts-expect-error - Internal API
	if (type.origin?.isUnion()) {
		// If a union type contains another union, `type.types` will contain the flattened types.
		// To resolve the original union type, we need to use the internal `type.origin.types`.
		// For example, given the types:
		// type U1 = string | number;
		// type U2 = U1 | boolean;
		// The `type.types` will contain [string, number, boolean], but we
		// need to resolve the original union type [U1, boolean] to get the correct type nodes.
		// `type.origin.types` will contain [U1, boolean].

		// @ts-expect-error - Internal API
		memberTypes = type.origin.types;
	}

	// If there's no provided type node or it's is not a union,
	// We check if the type declaration is an alias.
	// If so, it can point to the original union type.
	//
	// For example:
	// function f(x: Params) {}
	// type Params = SomeType | SomeOtherType;
	//
	// In this case `typeNode` will be set to the type reference of the function parameter,
	// so we extract the needed union definition.
	const typeAliasDeclaration = type.aliasSymbol?.declarations?.[0];
	if (
		(!typeNode || !ts.isUnionTypeNode(typeNode)) &&
		typeAliasDeclaration &&
		ts.isTypeAliasDeclaration(typeAliasDeclaration) &&
		ts.isUnionTypeNode(typeAliasDeclaration.type)
	) {
		typeNode = typeAliasDeclaration.type;
	}

	if (typeNode && ts.isUnionTypeNode(typeNode)) {
		// Here we're trying to match the union member types with TypeNodes
		// (what TS resolves to what was authored in code).
		// This is necessary as TS takes shortcuts when resolving types
		// and drop information about simple aliases like `type Foo = Bar;`
		// (it behaves like `Bar` doesn't exist at all).
		//
		// IMPORTANT: We iterate over `typeNode.types` (not `memberTypes`) to preserve source order.
		// The order of `type.types` (Types) doesn't match the order of `typeNode.types` (TypeNodes).
		// By iterating over TypeNodes first, we ensure the output matches the authored source order.
		//
		// For each TypeNode, we find the matching Type from memberTypes.
		// A Type is considered a match if:
		// - The TypeNode resolves to the same Type. This is the simplest case and covers non-generic types.
		// - The Type is a closed generic of type represented by TypeNode.
		//   For example, Type = `Array<string>` and TypeNode = `Array<T>`.

		// Track which memberTypes have been matched
		const matchedMemberTypes = new Set<ts.Type>();
		// Track resolved types that have been added to result (to avoid structural duplicates)
		const addedTypes: ts.Type[] = [];
		// Track the TypeNodes for each added type (to compare namespaced vs non-namespaced names)
		const addedTypeNodes: (ts.TypeNode | undefined)[] = [];

		for (const nodeType of typeNode.types) {
			// Get the type that this TypeNode resolves to
			const typeFromNode = checker.getTypeFromTypeNode(nodeType);

			// Check if we've already added a structurally equivalent type
			// This handles cases where different TypeNodes resolve to equivalent function types
			// (e.g., `(state: State) => ...` and `(state: Tooltip.Trigger.State) => ...`)
			const equivalentIndex = addedTypes.findIndex((addedType) =>
				areTypesEquivalent(checker, typeFromNode, addedType),
			);

			if (equivalentIndex !== -1) {
				// Found an equivalent type - check if the new one is more specific
				// Prefer namespaced types like `Tooltip.Trigger.State` over generic `State`
				// First check Type-level specificity, then TypeNode text (for namespaced names)
				const existingNode = addedTypeNodes[equivalentIndex];
				const isNewMoreSpecific =
					isMoreSpecificType(checker, typeFromNode, addedTypes[equivalentIndex]) ||
					isTypeNodeMoreSpecific(nodeType, existingNode);

				if (isNewMoreSpecific) {
					// Replace the less specific type with the more specific one
					addedTypes[equivalentIndex] = typeFromNode;
					addedTypeNodes[equivalentIndex] = nodeType;
					result[equivalentIndex] = resolveType(typeFromNode, nodeType, context);
				}
				// Mark as matched to prevent adding from memberTypes later
				matchedMemberTypes.add(typeFromNode);
				continue;
			}

			// Find the matching memberType
			const matchingMemberType = memberTypes.find((memberType) => {
				// Direct match or closed generic
				if (memberType === typeFromNode || isClosedGeneric(memberType, typeFromNode)) {
					return true;
				}
				// Also check structural equivalence - this handles cases where
				// function types have TypeParameter in typeFromNode but concrete type in memberType
				// (e.g., `(state: State) => ...` where State is a TypeParameter in the TypeNode
				// but resolves to `FormState` in the actual memberType)
				return areTypesEquivalent(checker, memberType, typeFromNode);
			});

			if (matchingMemberType) {
				matchedMemberTypes.add(matchingMemberType);
				addedTypes.push(matchingMemberType);
				addedTypeNodes.push(nodeType);
				// Use the matchingMemberType (properly resolved) but preserve the typeNode for naming
				result.push(resolveType(matchingMemberType, nodeType, context));
			} else {
				// No exact match found. This can happen with generic type parameters that get
				// instantiated differently. Use the resolved type from the TypeNode.
				// Mark the typeFromNode as matched to avoid adding it again from memberTypes.
				matchedMemberTypes.add(typeFromNode);
				addedTypes.push(typeFromNode);
				addedTypeNodes.push(nodeType);
				result.push(resolveType(typeFromNode, nodeType, context));
			}
		}

		// Add any remaining memberTypes that weren't matched (e.g., `undefined` added by TS for optional properties)
		// But skip any that are equivalent to types we already added, unless they are more specific
		for (const memberType of memberTypes) {
			if (!matchedMemberTypes.has(memberType)) {
				// Check if this memberType is equivalent to any we already processed
				// This handles cases where generic parameters resolve to the same underlying type
				let equivalentIndex = -1;
				for (let i = 0; i < addedTypes.length; i++) {
					if (areTypesEquivalent(checker, memberType, addedTypes[i])) {
						equivalentIndex = i;
						break;
					}
				}

				if (equivalentIndex !== -1) {
					// Found an equivalent type - check if the memberType is more specific
					// Prefer namespaced types like `Tooltip.Trigger.State` over generic `State`
					if (isMoreSpecificType(checker, memberType, addedTypes[equivalentIndex])) {
						// Replace the less specific type with the more specific one
						addedTypes[equivalentIndex] = memberType;
						result[equivalentIndex] = resolveType(memberType, undefined, context);
					}
				} else {
					result.push(resolveType(memberType, undefined, context));
				}
			}
		}
	} else {
		// Type is an union type, but TypeNode is not.
		// This can happen for optional properties: `foo?: T` is resolved as `T | undefined`.
		if (
			memberTypes.length === 2 &&
			memberTypes.some((x) => x.flags & ts.TypeFlags.Undefined) &&
			typeNode &&
			ts.isTypeReferenceNode(typeNode)
		) {
			// In such case propagate the parent TypeNode to the member types.
			// It will help to resolve T correctly and won't have any effect on the `undefined` type.
			for (const memberType of memberTypes) {
				result.push(resolveType(memberType, typeNode, context));
			}
		} else {
			for (const memberType of memberTypes) {
				result.push(resolveType(memberType, undefined, context));
			}
		}
	}

	const typeNameToUse = typeName?.name ? typeName : undefined;

	return result.length === 1 ? result[0] : new UnionNode(typeNameToUse, result);
}

function isClosedGeneric(type1: ts.Type, type2: ts.Type): boolean {
	if (!('target' in type1)) {
		return false;
	}

	return type1.target === type2 || ('target' in type2 && type1.target === type2.target);
}
