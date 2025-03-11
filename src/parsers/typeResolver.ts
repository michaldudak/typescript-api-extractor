import ts from 'typescript';
import * as t from '../types';
import { getDocumentationFromSymbol } from './documentationParser';
import { ParserContext } from '../parser';
import { parseMember } from './memberParser';
import { parseFunctionType } from './functionParser';

export function resolveType(
	type: ts.Type,
	name: string,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.TypeNode {
	const {
		checker,
		shouldInclude,
		shouldResolveObject,
		shouldResolveFunction,
		typeStack,
		includeExternalTypes,
	} = context;

	// If the typeStack contains type.id we're dealing with an object that references itself.
	// To prevent getting stuck in an infinite loop we just set it to an objectNode
	if (typeStack.includes((type as any).id)) {
		return t.objectNode();
	}

	typeStack.push((type as any).id);

	try {
		if (type.flags & ts.TypeFlags.TypeParameter && type.symbol) {
			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			return t.typeParameterNode(
				type.symbol.name,
				declaration?.constraint?.getText(),
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), '', context)
					: undefined,
			);
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			const typeName = getTypeName(type, checker);
			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (typeName === '__type.bivarianceHack') {
				return t.referenceNode('React.RefCallback');
			}

			return t.referenceNode(getTypeName(type, checker));
		}

		if (checker.isArrayType(type)) {
			// @ts-ignore - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return t.arrayNode(resolveType(arrayType, name, context));
		}

		if (hasFlag(type.flags, ts.TypeFlags.Boolean)) {
			return t.intrinsicNode('boolean');
		}

		if (hasFlag(type.flags, ts.TypeFlags.Void)) {
			return t.intrinsicNode('void');
		}

		if (type.isUnion()) {
			const memberTypes: t.TypeNode[] = [];
			const symbol = type.aliasSymbol ?? type.getSymbol();
			let typeName = symbol?.getName();
			if (typeName === '__type') {
				typeName = undefined;
			}

			for (const memberType of type.types) {
				memberTypes.push(resolveType(memberType, memberType.getSymbol()?.name || '', context));
			}

			return memberTypes.length === 1 ? memberTypes[0] : t.unionNode(typeName, memberTypes);
		}

		if (checker.isTupleType(type)) {
			return t.tupleNode(
				(type as ts.TupleType).typeArguments?.map((x) =>
					resolveType(x, x.getSymbol()?.name || '', context),
				) ?? [],
			);
		}

		if (type.flags & ts.TypeFlags.String) {
			return t.intrinsicNode('string');
		}

		if (type.flags & ts.TypeFlags.Number) {
			return t.intrinsicNode('number');
		}

		if (type.flags & ts.TypeFlags.BigInt) {
			return t.intrinsicNode('bigint');
		}

		if (type.flags & ts.TypeFlags.Undefined) {
			return t.intrinsicNode('undefined');
		}

		if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) {
			return t.intrinsicNode('any');
		}

		if (type.flags & ts.TypeFlags.Literal) {
			if (type.isLiteral()) {
				return t.literalNode(
					type.isStringLiteral() ? `"${type.value}"` : type.value,
					getDocumentationFromSymbol(type.symbol, checker)?.description,
				);
			}
			return t.literalNode(checker.typeToString(type));
		}

		if (type.flags & ts.TypeFlags.Null) {
			return t.literalNode('null');
		}

		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			if (
				skipResolvingComplexTypes ||
				!shouldResolveFunction({
					name,
					depth: typeStack.length,
				})
			) {
				return t.intrinsicNode('function');
			}

			return parseFunctionType(type, context)!;
		}

		// Object-like type
		{
			const properties = type.getProperties();
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
						return t.interfaceNode(
							typeName,
							filtered.map((property) => {
								return parseMember(
									property,
									property.valueDeclaration as ts.PropertySignature,
									context,
								);
							}),
						);
					}
				}

				if (typeName) {
					return t.referenceNode(typeName);
				}

				return t.objectNode();
			}
		}

		// Object without properties or object keyword
		if (
			type.flags & ts.TypeFlags.Object ||
			(type.flags & ts.TypeFlags.NonPrimitive && checker.typeToString(type) === 'object')
		) {
			return t.objectNode();
		}

		console.warn(
			`Unable to handle node of type "ts.TypeFlags.${ts.TypeFlags[type.flags]}", using any`,
		);

		return t.intrinsicNode('any');
	} finally {
		typeStack.pop();
	}
}

const allowedBuiltInTypes = new Set([
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

function isTypeExternal(type: ts.Type, checker: ts.TypeChecker): boolean {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	return (
		symbol?.declarations?.some((x) => {
			const sourceFileName = x.getSourceFile().fileName;
			const definedExternally = sourceFileName.includes('node_modules');
			return (
				definedExternally &&
				!(
					allowedBuiltInTypes.has(checker.getFullyQualifiedName(symbol)) &&
					/node_modules\/typescript\/lib/.test(sourceFileName)
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

	const typeName = checker.getFullyQualifiedName(symbol);

	const typeArguments = type.aliasTypeArguments?.map((x) => getTypeName(x, checker));
	if (typeArguments) {
		return `${typeName}<${typeArguments.join(', ')}>`;
	}

	return typeName;
}

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}
