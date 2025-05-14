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
	name: string,
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

	const namespaces = getTypeNamespaces(type);

	try {
		if (type.flags & ts.TypeFlags.TypeParameter && type.symbol) {
			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			return new TypeParameterNode(
				type.symbol.name,
				namespaces,
				declaration?.constraint?.getText(),
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), '', context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-expect-error - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(
				type.aliasSymbol?.name,
				namespaces,
				resolveType(arrayType, name, context),
			);
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			const typeName = getTypeName(type, checker);
			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (typeName === 'bivarianceHack') {
				return new ReferenceNode('RefCallback', []);
			}

			return new ReferenceNode(getTypeName(type, checker), namespaces);
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
			const memberTypes: TypeNode[] = [];
			const symbol = type.aliasSymbol ?? type.getSymbol();
			let typeName = symbol?.getName();
			if (typeName === '__type') {
				typeName = undefined;
			}

			// @ts-expect-error - Internal API
			if (type.origin?.isUnion()) {
				// @ts-expect-error - Internal API
				for (const memberType of type.origin.types) {
					memberTypes.push(resolveType(memberType, memberType.getSymbol()?.name || '', context));
				}
			} else {
				for (const memberType of type.types) {
					memberTypes.push(resolveType(memberType, memberType.getSymbol()?.name || '', context));
				}
			}

			return memberTypes.length === 1
				? memberTypes[0]
				: new UnionNode(typeName, namespaces, memberTypes);
		}

		if (type.isIntersection()) {
			const memberTypes: TypeNode[] = [];
			const symbol = type.aliasSymbol ?? type.getSymbol();
			let typeName = symbol?.getName();
			if (typeName === '__type') {
				typeName = undefined;
			}

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, memberType.getSymbol()?.name || '', context));
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

				const objectType = parseObjectType(type, name, context, skipResolvingComplexTypes);
				if (objectType) {
					return new IntersectionNode(typeName, namespaces, memberTypes, objectType.properties);
				}

				return new IntersectionNode(typeName, namespaces, memberTypes, []);
			}
		}

		if (checker.isTupleType(type)) {
			return new TupleNode(
				undefined,
				[],
				(type as ts.TupleType).typeArguments?.map((x) =>
					resolveType(x, x.getSymbol()?.name || '', context),
				) ?? [],
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
			return new IntrinsicNode('any');
		}

		if (type.flags & ts.TypeFlags.Unknown) {
			return new IntrinsicNode('unknown');
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

		const objectType = parseObjectType(type, name, context, skipResolvingComplexTypes);
		if (objectType) {
			return objectType;
		}

		// Object without properties or object keyword
		if (
			type.flags & ts.TypeFlags.Object ||
			(type.flags & ts.TypeFlags.NonPrimitive && checker.typeToString(type) === 'object')
		) {
			const typeSymbol = type.aliasSymbol ?? type.getSymbol();
			let typeName = typeSymbol?.getName();
			if (typeName === '__type') {
				typeName = undefined;
			}

			return new ObjectNode(typeName, namespaces, [], undefined);
		}

		if (type.flags & ts.TypeFlags.Conditional) {
			// We don't fully support conditional types. We assume the condition is always true.
			if (
				type.aliasSymbol?.declarations?.[0] &&
				ts.isTypeAliasDeclaration(type.aliasSymbol.declarations[0]) &&
				ts.isConditionalTypeNode(type.aliasSymbol.declarations[0].type)
			) {
				const trueType = checker.getTypeFromTypeNode(
					type.aliasSymbol.declarations[0].type.trueType,
				);
				return resolveType(trueType, name, context);
			}
		}

		console.warn(
			`Unable to handle a type with flag "${ts.TypeFlags[type.flags]}". Using any instead.`,
		);

		return new IntrinsicNode('any');
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

	if (symbol.name === '__function' || symbol.name === '__type') {
		return [];
	}

	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration) {
		return [];
	}

	const namespaces: string[] = [];
	let currentDeclaration: ts.Node = declaration.parent;

	while (currentDeclaration != null && !ts.isSourceFile(currentDeclaration)) {
		if (ts.isModuleDeclaration(currentDeclaration)) {
			namespaces.unshift(currentDeclaration.name.getText());
		}

		currentDeclaration = currentDeclaration.parent;
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

function getTypeName(type: ts.Type, checker: ts.TypeChecker): string {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	if (!symbol) {
		return checker.typeToString(type);
	}

	const typeName = symbol.getName();
	if (typeName === '__type') {
		return checker.typeToString(type);
	}

	let typeArguments: string[] | undefined;
	if ('target' in type) {
		typeArguments = checker
			.getTypeArguments(type as ts.TypeReference)
			?.map((x) => getTypeName(x, checker));
	}

	if (!typeArguments?.length) {
		typeArguments = type.aliasTypeArguments?.map((x) => getTypeName(x, checker)) ?? [];
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
