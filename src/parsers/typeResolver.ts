import ts from 'typescript';
import { getDocumentationFromSymbol } from './documentationParser';
import { ParserContext } from '../parser';
import { parseFunctionType } from './functionParser';
import { parseObjectType } from './objectParser';
import { parseEnum } from './enumParser';
import {
	ObjectNode,
	TypeParameterNode,
	ArrayNode,
	ExternalTypeNode,
	IntrinsicNode,
	UnionNode,
	TupleNode,
	LiteralNode,
	IntersectionNode,
	AnyType,
} from '../models';
import { resolveUnionType } from './unionTypeResolver';
import { getFullName } from './common';
import { TypeName } from '../models/typeName';

/**
 *
 * @param type TypeScript type to resolve
 * @param typeNode TypeScript TypeNode associated with the type, if available. It can be used to preserve the authored type name.
 * @param context Parser context containing TypeScript checker and other utilities.
 */
export function resolveType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): AnyType {
	const { checker, typeStack, includeExternalTypes } = context;

	const typeId = getTypeId(type);

	// If the typeStack contains type.id we're dealing with an object that references itself.
	// To prevent getting stuck in an infinite loop we just set it to an objectNode
	// However, we should not apply this check to intrinsic types like any/unknown/string/etc
	// as they can appear multiple times without causing infinite recursion
	const isIntrinsicType = (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0;

	if (!isIntrinsicType && typeId !== undefined && typeStack.includes(typeId)) {
		return new ObjectNode(undefined, [], undefined);
	}

	if (!isIntrinsicType && typeId !== undefined) {
		typeStack.push(typeId);
	}

	const typeName = getFullName(type, typeNode, context);

	try {
		if (hasExactFlag(type, ts.TypeFlags.TypeParameter) && type.symbol) {
			const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
			const constraintType = declaration?.constraint
				? checker.getBaseConstraintOfType(type)
				: undefined;

			return new TypeParameterNode(
				type.symbol.name,
				constraintType ? resolveType(constraintType, undefined, context) : undefined,
				declaration?.default
					? resolveType(checker.getTypeAtLocation(declaration.default), undefined, context)
					: undefined,
			);
		}

		if (checker.isArrayType(type)) {
			// @ts-expect-error - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return new ArrayNode(
				type.aliasSymbol?.name
					? new TypeName(type.aliasSymbol?.name, typeName?.namespaces, typeName?.typeArguments)
					: undefined,
				resolveType(arrayType, undefined, context),
			);
		}

		if (!includeExternalTypes && isTypeExternal(type, checker)) {
			if (!typeName) {
				return new IntrinsicNode('any');
			}

			// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
			if (typeName.name === 'bivarianceHack') {
				return new ExternalTypeNode(new TypeName('RefCallback', ['React'], typeName.typeArguments));
			}

			return new ExternalTypeNode(
				new TypeName(
					typeName.name ||
						(type.aliasSymbol?.getName?.() ?? type.getSymbol()?.getName?.() ?? 'unknown'),
					typeName.namespaces,
					typeName.typeArguments,
				),
			);
		}

		if (hasExactFlag(type, ts.TypeFlags.Boolean)) {
			return new IntrinsicNode('boolean');
		}

		if (hasExactFlag(type, ts.TypeFlags.Void)) {
			return new IntrinsicNode('void');
		}

		if (includesCompositeFlag(type, ts.TypeFlags.EnumLike)) {
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
			return resolveUnionType(type, typeName, typeNode, context);
		}

		if (type.isIntersection()) {
			const memberTypes: AnyType[] = [];

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
					return parseFunctionType(type, context)!;
				}

				const objectType = parseObjectType(type, typeName, context);
				if (objectType) {
					return new IntersectionNode(typeName, memberTypes, objectType.properties);
				}

				return new IntersectionNode(typeName, memberTypes, []);
			}
		}

		if (checker.isTupleType(type)) {
			return new TupleNode(
				typeName,
				(type as ts.TupleType).typeArguments?.map((x) => resolveType(x, undefined, context)) ?? [],
			);
		}

		if (hasExactFlag(type, ts.TypeFlags.String)) {
			return new IntrinsicNode('string');
		}

		if (hasExactFlag(type, ts.TypeFlags.Number)) {
			return new IntrinsicNode('number');
		}

		if (hasExactFlag(type, ts.TypeFlags.BigInt)) {
			return new IntrinsicNode('bigint');
		}

		if (hasExactFlag(type, ts.TypeFlags.Undefined)) {
			return new IntrinsicNode('undefined');
		}

		if (hasExactFlag(type, ts.TypeFlags.Any)) {
			// Special case: if the authored typeNode is a union (e.g., `AliasedAny | undefined`),
			// we should resolve it as a union to preserve alias information,
			// even though TypeScript simplifies `any | T` to just `any` in the type system.
			if (typeNode && ts.isUnionTypeNode(typeNode)) {
				const unionTypes: AnyType[] = [];
				for (const memberTypeNode of typeNode.types) {
					// Get the type from the type node
					const memberType = checker.getTypeFromTypeNode(memberTypeNode);
					// Recursively resolve, passing the memberTypeNode so alias information is preserved
					unionTypes.push(resolveType(memberType, memberTypeNode, context));
				}
				return new UnionNode(typeName, unionTypes);
			}
			return new IntrinsicNode('any', typeName);
		}

		if (hasExactFlag(type, ts.TypeFlags.Unknown)) {
			return new IntrinsicNode('unknown', typeName);
		}

		if (includesCompositeFlag(type, ts.TypeFlags.Literal)) {
			if (type.isLiteral()) {
				return new LiteralNode(
					type.isStringLiteral() ? `"${type.value}"` : type.value,
					typeName,
					getDocumentationFromSymbol(type.symbol, checker),
				);
			}

			return new LiteralNode(checker.typeToString(type));
		}

		if (hasExactFlag(type, ts.TypeFlags.Null)) {
			return new IntrinsicNode('null');
		}

		// TODO: currently types can be either a "function" or an "object" but not both.
		// In reality, type can have both call signatures and properties.
		// Consider creating a new type that can handle both.
		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			return parseFunctionType(type, context)!;
		}

		const objectType = parseObjectType(type, typeName, context);
		if (objectType) {
			return objectType;
		}

		// Object without properties or object keyword
		if (
			hasExactFlag(type, ts.TypeFlags.Object) ||
			(hasExactFlag(type, ts.TypeFlags.NonPrimitive) && checker.typeToString(type) === 'object')
		) {
			return new ObjectNode(typeName, [], undefined);
		}

		if (hasExactFlag(type, ts.TypeFlags.Conditional)) {
			const conditionalType = type as ts.ConditionalType;
			if (conditionalType.resolvedTrueType && conditionalType.resolvedFalseType) {
				return new UnionNode(undefined, [
					// TODO: Pass TypeNode here to resolve aliases correctly
					resolveType((type as ts.ConditionalType).resolvedTrueType!, undefined, context),
					resolveType((type as ts.ConditionalType).resolvedFalseType!, undefined, context),
				]);
			} else if (conditionalType.resolvedTrueType) {
				return resolveType(conditionalType.resolvedTrueType, undefined, context);
			} else if (conditionalType.resolvedFalseType) {
				return resolveType(conditionalType.resolvedFalseType, undefined, context);
			}
		}

		console.warn(
			`Unable to handle a type with flag "${ts.TypeFlags[type.flags]}". Using any instead.`,
		);

		return new IntrinsicNode('any', typeName);
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

function hasExactFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) === flag;
}

function includesCompositeFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) !== 0;
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
