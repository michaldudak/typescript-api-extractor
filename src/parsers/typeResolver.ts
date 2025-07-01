import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { ParserContext } from '../parser';
import { parseFunctionType } from './functionParser';
import { parseObjectType } from './objectParser';
import { parseEnum } from './enumParser';
import {
	ObjectNode,
	TypeNode,
	TypeParameterNode,
	ArrayNode,
	ReferenceNode,
	IntrinsicNode,
	UnionNode,
	TupleNode,
	LiteralNode,
	IntersectionNode,
} from '../models';
import { resolveUnionType } from './unionTypeResolver';
import { getTypeName } from './common';

/**
 *
 * @param type TypeScript type to resolve
 * @param typeNode TypeScript TypeNode associated with the type, if available. It can be used to preserve the authored type name.
 * @param context Parser context containing TypeScript checker and other utilities.
 * @param skipResolvingComplexTypes If true, complex types like functions and objects will be resolved to their intrinsic types (e.g., 'function', 'object').
 */
export function resolveType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): TypeNode {
	const { checker, typeStack, includeExternalTypes } = context;

	const typeId = getTypeId(type);

	// If the typeStack contains type.id we're dealing with an object that references itself.
	// To prevent getting stuck in an infinite loop we just set it to an objectNode
	if (typeId !== undefined && typeStack.includes(typeId)) {
		return new ObjectNode(undefined, [], [], undefined);
	}

	if (typeId !== undefined) {
		typeStack.push(typeId);
	}

	// The following code handles cases where the type is a simple alias of another type (type Alias = SomeType).
	// TypeScript resolves the alias automatically, but we want to preserve the original type symbol if it exists.
	//
	// However, this also covers cases where the type is a type parameter (as in `type Generic<T> = { value: T }`).
	// Here we don't want to preserve T as a type symbol, but rather resolve it to its actual type.
	let typeSymbol: ts.Symbol | undefined;
	if (typeNode && ts.isTypeReferenceNode(typeNode)) {
		const typeNodeName = (typeNode as ts.TypeReferenceNode).typeName;
		let typeSymbolCandidate: ts.Symbol | undefined;
		if (ts.isIdentifier(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
		} else if (ts.isQualifiedName(typeNodeName)) {
			typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
		}

		if (
			typeSymbolCandidate &&
			!areEquivalent(typeNodeName, type, checker) &&
			!(typeSymbolCandidate.flags & ts.SymbolFlags.TypeParameter)
		) {
			typeSymbol = typeSymbolCandidate;
		}
	}

	const namespaces = typeSymbol ? getTypeSymbolNamespaces(typeSymbol) : getTypeNamespaces(type);

	try {
		if (type.flags & ts.TypeFlags.TypeParameter && type.symbol) {
			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			return new TypeParameterNode(
				type.symbol.name,
				namespaces,
				declaration?.constraint?.getText(),
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), undefined, context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-expect-error - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(
				type.aliasSymbol?.name,
				namespaces,
				resolveType(arrayType, undefined, context),
			);
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			const typeName = getTypeName(type, typeSymbol, checker);
			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (typeName === 'bivarianceHack') {
				return new ReferenceNode('RefCallback', []);
			}

			return new ReferenceNode(typeName ?? checker.typeToString(type), namespaces);
		}

		if (hasFlag(type.flags, ts.TypeFlags.Boolean)) {
			return new IntrinsicNode('boolean');
		}

		if (hasFlag(type.flags, ts.TypeFlags.Void)) {
			return new IntrinsicNode('void');
		}

		if (type.flags & ts.TypeFlags.EnumLike) {
			let symbol = type.aliasSymbol ?? type.getSymbol();
			if ('value' in type) {
				// weird edge case - when an enum has one member only, type.getSymbol() returns the symbol of the member
				symbol = symbol?.parent;
			}

			if (!symbol) {
				return new IntrinsicNode('any');
			}

			return parseEnum(symbol, context);
		}

		if (type.isUnion()) {
			const typeName = getTypeName(type, typeSymbol, checker, false);
			return resolveUnionType(type, typeName, typeNode, context, namespaces);
		}

		if (type.isIntersection()) {
			const memberTypes: TypeNode[] = [];
			const typeName = getTypeName(type, typeSymbol, checker, false);

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, undefined, context));
			}

			if (memberTypes.length === 0) {
				throw new Error('Encountered an intersection type with no members');
			}

			if (memberTypes.length === 1) {
				return memberTypes[0];
			}

			if (memberTypes.length > 1) {
				const callSignatures = type.getCallSignatures();
				if (callSignatures.length >= 1) {
					if (skipResolvingComplexTypes) {
						return new IntrinsicNode('function');
					}

					return parseFunctionType(type, context)!;
				}

				const objectType = parseObjectType(type, context, skipResolvingComplexTypes);
				if (objectType) {
					return new IntersectionNode(typeName, namespaces, memberTypes, objectType.properties);
				}

				return new IntersectionNode(typeName, namespaces, memberTypes, []);
			}
		}

		if (checker.isTupleType(type)) {
			return new TupleNode(
				typeSymbol?.name ?? type.aliasSymbol?.name,
				namespaces,
				(type as ts.TupleType).typeArguments?.map((x) => resolveType(x, undefined, context)) ?? [],
			);
		}

		if (type.flags & ts.TypeFlags.String) {
			return new IntrinsicNode('string');
		}

		if (type.flags & ts.TypeFlags.Number) {
			return new IntrinsicNode('number');
		}

		if (type.flags & ts.TypeFlags.BigInt) {
			return new IntrinsicNode('bigint');
		}

		if (type.flags & ts.TypeFlags.Undefined) {
			return new IntrinsicNode('undefined');
		}

		if (type.flags & ts.TypeFlags.Any) {
			return new IntrinsicNode('any', typeSymbol?.name ?? type.aliasSymbol?.name, namespaces);
		}

		if (type.flags & ts.TypeFlags.Unknown) {
			return new IntrinsicNode('unknown', typeSymbol?.name ?? type.aliasSymbol?.name, namespaces);
		}

		if (type.flags & ts.TypeFlags.Literal) {
			if (type.isLiteral()) {
				return new LiteralNode(
					type.isStringLiteral() ? `"${type.value}"` : type.value,
					getDocumentationFromSymbol(type.symbol, checker),
				);
			}
			return new LiteralNode(checker.typeToString(type));
		}

		if (type.flags & ts.TypeFlags.Null) {
			return new IntrinsicNode('null');
		}

		// TODO: currently types can be either a "function" or an "object" but not both.
		// In reality, type can have both call signatures and properties.
		// Consider creating a new type that can handle both.
		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			if (skipResolvingComplexTypes) {
				return new IntrinsicNode('function');
			}

			return parseFunctionType(type, context)!;
		}

		const objectType = parseObjectType(type, context, skipResolvingComplexTypes);
		if (objectType) {
			return objectType;
		}

		// Object without properties or object keyword
		if (
			type.flags & ts.TypeFlags.Object ||
			(type.flags & ts.TypeFlags.NonPrimitive && checker.typeToString(type) === 'object')
		) {
			const typeName = getTypeName(type, typeSymbol, checker, false);
			return new ObjectNode(typeName, namespaces, [], undefined);
		}

		if (type.flags & ts.TypeFlags.Conditional) {
			const conditionalType = type as ts.ConditionalType;
			if (conditionalType.resolvedTrueType && conditionalType.resolvedFalseType) {
				return new UnionNode(
					undefined,
					[],
					[
						// TODO: Pass TypeNode here to resolve aliases correctly
						resolveType((type as ts.ConditionalType).resolvedTrueType!, undefined, context),
						resolveType((type as ts.ConditionalType).resolvedFalseType!, undefined, context),
					],
				);
			} else if (conditionalType.resolvedTrueType) {
				return resolveType(conditionalType.resolvedTrueType, undefined, context);
			} else if (conditionalType.resolvedFalseType) {
				return resolveType(conditionalType.resolvedFalseType, undefined, context);
			}
		}

		console.warn(
			`Unable to handle a type with flag "${ts.TypeFlags[type.flags]}". Using any instead.`,
		);

		return new IntrinsicNode('any', typeSymbol?.name ?? type.aliasSymbol?.name, namespaces);
	} finally {
		typeStack.pop();
	}
}

const allowedBuiltInTsTypes = new Set([
	'Pick',
	'Omit',
	'ReturnType',
	'Parameters',
	'InstanceType',
	'Partial',
	'Required',
	'Readonly',
	'Exclude',
	'Extract',
]);

const allowedBuiltInReactTypes = new Set([
	'React.NamedExoticComponent',
	'React.FC',
	'React.FunctionComponent',
	'React.ForwardRefExoticComponent',
]);

export function getTypeNamespaces(type: ts.Type): string[] {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return [];
	}

	return getTypeSymbolNamespaces(symbol);
}

function getTypeSymbolNamespaces(typeSymbol: ts.Symbol): string[] {
	if (typeSymbol.name === '__function' || typeSymbol.name === '__type') {
		return [];
	}

	const declaration = typeSymbol.valueDeclaration ?? typeSymbol.declarations?.[0];
	return getNodeNamespaces(declaration);
}
export function getNodeNamespaces(node: ts.Node | undefined): string[] {
	if (!node) {
		return [];
	}

	const namespaces: string[] = [];
	let currentNode = node.parent;

	while (currentNode != null && !ts.isSourceFile(currentNode)) {
		if (ts.isModuleDeclaration(currentNode)) {
			namespaces.unshift(currentNode.name.getText());
		}

		currentNode = currentNode.parent;
	}

	return namespaces;
}

function isTypeExternal(type: ts.Type, checker: ts.TypeChecker): boolean {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	return (
		symbol?.declarations?.some((x) => {
			const sourceFileName = x.getSourceFile().fileName;
			const definedExternally = sourceFileName.includes('node_modules');
			return (
				definedExternally &&
				!(
					(allowedBuiltInTsTypes.has(checker.getFullyQualifiedName(symbol)) &&
						/node_modules\/typescript\/lib/.test(sourceFileName)) ||
					(allowedBuiltInReactTypes.has(checker.getFullyQualifiedName(symbol)) &&
						/node_modules\/@types\/react/.test(sourceFileName))
				)
			);
		}) ?? false
	);
}

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}

function getTypeId(type: ts.Type): number | undefined {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
}

function areEquivalent(
	typeNodeName: ts.EntityName,
	type: ts.Type,
	checker: ts.TypeChecker,
): boolean | undefined {
	if (ts.isIdentifier(typeNodeName)) {
		const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
		if (!typeSymbolCandidate) {
			return undefined;
		}

		return (
			typeNodeName.text === type.aliasSymbol?.name &&
			getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
		);
	} else if (ts.isQualifiedName(typeNodeName)) {
		const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
		if (!typeSymbolCandidate) {
			return undefined;
		}

		return (
			typeNodeName.right.text === type.aliasSymbol?.name &&
			getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
		);
	}

	return undefined;
}

// Internal API
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
