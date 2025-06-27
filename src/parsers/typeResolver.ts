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

export function resolveType(
	type: ts.Type,
	context: ParserContext,
	typeNode?: ts.TypeNode,
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
		if (ts.isIdentifier(typeNodeName)) {
			const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);

			if (
				typeSymbolCandidate &&
				(typeNodeName.text !== type.aliasSymbol?.name ||
					getTypeSymbolNamespaces(typeSymbolCandidate).join('.') !==
						getTypeNamespaces(type).join('.')) &&
				!(typeSymbolCandidate.flags & ts.SymbolFlags.TypeParameter)
			) {
				typeSymbol = typeSymbolCandidate;
			}
		} else if (ts.isQualifiedName(typeNodeName)) {
			const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
			if (
				typeSymbolCandidate &&
				(typeNodeName.right.text !== type.aliasSymbol?.name ||
					getTypeSymbolNamespaces(typeSymbolCandidate).join('.') !==
						getTypeNamespaces(type).join('.')) &&
				!(typeSymbolCandidate.flags & ts.SymbolFlags.TypeParameter)
			) {
				typeSymbol = typeSymbolCandidate;
			}
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
					? resolveType(checker.getTypeAtLocation(declaration.default), context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-expect-error - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(type.aliasSymbol?.name, namespaces, resolveType(arrayType, context));
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
			let memberTypes: ts.Type[] = type.types;
			const parsedMemberTypes: TypeNode[] = [];
			const typeName = getTypeName(type, typeSymbol, checker, false);

			// @ts-expect-error - Internal API
			if (type.origin?.isUnion()) {
				// @ts-expect-error - Internal API

				// If a union type contains another union, `type.types` will contain the flattened types.
				// To resolve the original union type, we need to use the internal `type.origin.types`.
				memberTypes = type.origin.types;
			}

			if (memberTypes.length === 2 && memberTypes.some((x) => x.flags & ts.TypeFlags.Undefined)) {
				// If the union is `T | undefined`, we propagate the typeNode of T to the union member so that any aliases are resolved correctly.
				for (const memberType of memberTypes) {
					parsedMemberTypes.push(resolveType(memberType, context, typeNode));
				}
			} else {
				for (const memberType of memberTypes) {
					parsedMemberTypes.push(resolveType(memberType, context));
				}
			}

			return parsedMemberTypes.length === 1
				? parsedMemberTypes[0]
				: new UnionNode(typeName, namespaces, parsedMemberTypes);
		}

		if (type.isIntersection()) {
			const memberTypes: TypeNode[] = [];
			const typeName = getTypeName(type, typeSymbol, checker, false);

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, context));
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
				(type as ts.TupleType).typeArguments?.map((x) => resolveType(x, context)) ?? [],
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
						resolveType((type as ts.ConditionalType).resolvedTrueType!, context),
						resolveType((type as ts.ConditionalType).resolvedFalseType!, context),
					],
				);
			} else if (conditionalType.resolvedTrueType) {
				return resolveType(conditionalType.resolvedTrueType, context);
			} else if (conditionalType.resolvedFalseType) {
				return resolveType(conditionalType.resolvedFalseType, context);
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

export function getTypeName(
	type: ts.Type,
	typeSymbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
	useFallback: boolean = true,
): string | undefined {
	const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	if (typeSymbol && !type.aliasSymbol && !type.symbol) {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	const typeName = symbol.getName();
	if (typeName === '__type') {
		return useFallback ? checker.typeToString(type) : undefined;
	}

	let typeArguments: string[] | undefined;

	if (type.aliasSymbol && !type.aliasTypeArguments) {
		typeArguments = [];
	} else {
		if ('target' in type) {
			typeArguments = checker
				.getTypeArguments(type as ts.TypeReference)
				?.map((x) => getTypeName(x, undefined, checker, true) ?? 'unknown');
		}

		if (!typeArguments?.length) {
			typeArguments =
				type.aliasTypeArguments?.map(
					(x) => getTypeName(x, undefined, checker, true) ?? 'unknown',
				) ?? [];
		}
	}

	if (typeArguments && typeArguments.length > 0) {
		return `${typeName}<${typeArguments.join(', ')}>`;
	}

	return typeName;
}

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}

function getTypeId(type: ts.Type): number | undefined {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
}

// Internal API
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
