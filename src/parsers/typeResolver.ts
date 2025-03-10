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

		if (
			!includeExternalTypes &&
			type
				.getSymbol()
				?.declarations?.some(
					(x) =>
						x.getSourceFile().fileName.includes('node_modules') &&
						!x.getSourceFile().fileName.includes('typescript'),
				)
		) {
			return t.referenceNode(checker.getFullyQualifiedName(type.getSymbol()!));
		}

		{
			const propNode = type as any;

			const symbol = propNode.aliasSymbol ? propNode.aliasSymbol : propNode.symbol;
			const typeName = symbol ? checker.getFullyQualifiedName(symbol) : null;
			switch (typeName) {
				case 'global.JSX.Element':
				case 'React.JSX.Element':
				case 'React.ReactElement':
				case 'React.ElementType':
				case 'Date':
				case 'React.Component':
				case 'Element':
				case 'HTMLElement': {
					return t.referenceNode(typeName);
				}
				case 'React.ReactNode': {
					return t.unionNode([t.referenceNode(typeName), t.intrinsicNode('undefined')]);
				}
			}
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
			const node = t.unionNode(
				type.types.map((x) => resolveType(x, x.getSymbol()?.name || '', context)),
			);

			return node.types.length === 1 ? node.types[0] : node;
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
					const filtered = properties.filter((symbol) =>
						shouldInclude({ name: symbol.getName(), depth: typeStack.length + 1 }),
					);
					if (filtered.length > 0) {
						return t.interfaceNode(
							typeName,
							filtered.map((x) => parseMember(x, context)),
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

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}
