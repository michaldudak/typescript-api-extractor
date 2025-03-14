import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { ParserContext } from '../parser';
import { parseMember } from './memberParser';
import { parseFunctionType } from './functionParser';
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
} from '../models';

export function resolveType(
	type: ts.Type,
	name: string,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): TypeNode {
	const { checker, shouldInclude, shouldResolveObject, typeStack, includeExternalTypes } = context;

	// If the typeStack contains type.id we're dealing with an object that references itself.
	// To prevent getting stuck in an infinite loop we just set it to an objectNode
	if (typeStack.includes((type as any).id)) {
		return new ObjectNode(undefined, [], undefined);
	}

	typeStack.push((type as any).id);

	try {
		if (type.flags & ts.TypeFlags.TypeParameter && type.symbol) {
			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			return new TypeParameterNode(
				type.symbol.name,
				declaration?.constraint?.getText(),
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), '', context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-ignore - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(resolveType(arrayType, name, context));
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			const typeName = getTypeName(type, checker);
			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (typeName === 'bivarianceHack') {
				return new ReferenceNode('RefCallback');
			}

			return new ReferenceNode(getTypeName(type, checker));
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
				// @ts-expect-error internal API
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

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, memberType.getSymbol()?.name || '', context));
			}

			return memberTypes.length === 1 ? memberTypes[0] : new UnionNode(typeName, memberTypes);
		}

		if (checker.isTupleType(type)) {
			return new TupleNode(
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

		if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) {
			return new IntrinsicNode('any');
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
			return new LiteralNode('null');
		}

		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			if (skipResolvingComplexTypes) {
				return new IntrinsicNode('function');
			}

			return parseFunctionType(type, context)!;
		}

		// Object-like type
		{
			const properties = type
				.getProperties()
				.filter((property) => includeExternalTypes || !isPropertyExternal(property));

			const typeSymbol = type.aliasSymbol ?? type.getSymbol();
			let typeName = typeSymbol?.getName();
			if (typeName === '__type') {
				typeName = undefined;
			}

			if (properties.length) {
				if (
					!skipResolvingComplexTypes &&
					shouldResolveObject({ name, propertyCount: properties.length, depth: typeStack.length })
				) {
					const filtered = properties.filter((property) => {
						const declaration =
							property.valueDeclaration ??
							(property.declarations?.[0] as ts.PropertySignature | undefined);
						return (
							declaration &&
							ts.isPropertySignature(declaration) &&
							shouldInclude({ name: property.getName(), depth: typeStack.length + 1 })
						);
					});
					if (filtered.length > 0) {
						return new ObjectNode(
							typeName,
							filtered.map((property) => {
								return parseMember(
									property,
									property.valueDeclaration as ts.PropertySignature,
									context,
								);
							}),
							undefined,
						);
					}
				}

				if (typeName) {
					return new ReferenceNode(typeName);
				}

				return new ObjectNode(undefined, [], undefined);
			}
		}

		// Object without properties or object keyword
		if (
			type.flags & ts.TypeFlags.Object ||
			(type.flags & ts.TypeFlags.NonPrimitive && checker.typeToString(type) === 'object')
		) {
			return new ObjectNode(undefined, [], undefined);
		}

		console.warn(
			`Unable to handle node of type "ts.TypeFlags.${ts.TypeFlags[type.flags]}", using any`,
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

function isPropertyExternal(property: ts.Symbol): boolean {
	return (
		property.declarations?.every((declaration) =>
			declaration.getSourceFile().fileName.includes('node_modules'),
		) ?? false
	);
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

	const typeArguments = type.aliasTypeArguments?.map((x) => getTypeName(x, checker));
	if (typeArguments) {
		return `${typeName}<${typeArguments.join(', ')}>`;
	}

	return typeName;
}

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}
