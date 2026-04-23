import ts from 'typescript';
import { parseProperty } from './propertyParser';
import { ParserContext } from '../parser';
import {
	ObjectNode,
	TypeName,
	IndexSignatureNode,
	AnyType,
	UnionNode,
	IntrinsicNode,
} from '../models';

/**
 * Parse the index signature of an object type if it has one.
 * Only works for actual object types (not conditional types, etc.)
 */
function parseIndexSignature(
	type: ts.Type,
	context: ParserContext,
	resolveValueType: (
		type: ts.Type,
		typeNode: ts.TypeNode | undefined,
		context: ParserContext,
	) => AnyType,
): IndexSignatureNode | undefined {
	const { checker } = context;

	// Only check index signatures on actual object types
	// Conditional types and other non-object types may report index signatures incorrectly
	if (!isObjectType(type)) {
		return undefined;
	}

	// Helper to extract key parameter name from index signature declaration
	const getKeyName = (indexInfo: ts.IndexInfo): string | undefined => {
		const declaration = indexInfo.declaration;
		if (declaration && ts.isIndexSignatureDeclaration(declaration)) {
			// Index signature has parameters like [fileName: string]
			const keyParam = declaration.parameters[0];
			if (keyParam && ts.isParameter(keyParam)) {
				return keyParam.name.getText();
			}
		}
		return undefined;
	};

	// Try string index first
	const stringIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.String);
	if (stringIndexInfo) {
		return {
			keyName: getKeyName(stringIndexInfo),
			keyType: 'string',
			valueType: resolveValueType(stringIndexInfo.type, undefined, context),
		};
	}

	// Then try number index
	const numberIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.Number);
	if (numberIndexInfo) {
		return {
			keyName: getKeyName(numberIndexInfo),
			keyType: 'number',
			valueType: resolveValueType(numberIndexInfo.type, undefined, context),
		};
	}

	// For mapped types with a generic key (e.g., { [key in K]?: V } where K extends string),
	// getIndexInfoOfType returns nothing because K is an unresolved TypeParameter.
	// Synthesize an index signature by following K's base constraint to string/number.
	// Intentionally not handled: `as` clauses, and constraints that resolve to a union
	// (e.g., `K extends 'a' | 'b'`, bigint, symbol, or template-literal types) — those
	// fall through and produce no index signature.
	if (type.objectFlags & ts.ObjectFlags.Mapped) {
		const mappedNode = type.symbol?.declarations?.find(ts.isMappedTypeNode);

		if (mappedNode && mappedNode.type) {
			const templateType = checker.getTypeAtLocation(mappedNode.type);
			const constraintNode = mappedNode.typeParameter.constraint;
			const constraintType = constraintNode
				? checker.getBaseConstraintOfType(checker.getTypeAtLocation(constraintNode)) ??
					checker.getTypeAtLocation(constraintNode)
				: undefined;

			if (constraintType) {
				// Only `string` and `number` are emitted as index signature key types;
				// other constraints (bigint, symbol, unions, template literals) fall through.
				let keyType: 'string' | 'number' | undefined;
				if (constraintType.flags & ts.TypeFlags.String) {
					keyType = 'string';
				} else if (constraintType.flags & ts.TypeFlags.Number) {
					keyType = 'number';
				}

				if (keyType) {
					let valueType = resolveTemplateValueType(templateType, checker, (t) =>
						resolveValueType(t, undefined, context),
					);
					// A `?` (or `+?`) modifier makes the property optional, adding
					// `undefined` to the value type. `-?` strips it. No modifier: no change.
					const questionToken = mappedNode.questionToken;
					if (questionToken && questionToken.kind !== ts.SyntaxKind.MinusToken) {
						// `unknown`/`any` absorb `undefined`, mirroring TS union normalization.
						if (
							!(
								valueType instanceof IntrinsicNode &&
								(valueType.intrinsic === 'unknown' || valueType.intrinsic === 'any')
							)
						) {
							valueType = new UnionNode(undefined, [valueType, new IntrinsicNode('undefined')]);
						}
					}

					return {
						keyName: mappedNode.typeParameter.name.text,
						keyType,
						valueType,
					};
				}
			}
		}
	}

	return undefined;
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
	return Boolean(type.flags & ts.TypeFlags.Object);
}

function resolveTypeParamDefault(type: ts.Type, checker: ts.TypeChecker): ts.Type {
	if (type.flags & ts.TypeFlags.TypeParameter) {
		const declaration = type.symbol?.declarations?.[0];
		if (declaration && ts.isTypeParameterDeclaration(declaration) && declaration.default) {
			return checker.getTypeAtLocation(declaration.default);
		}
	}
	return type;
}

/**
 * Resolve a mapped-type template into a model-level type, substituting type
 * parameter defaults. Unions are expanded per-member and rebuilt as a model
 * `UnionNode`, avoiding reliance on the internal `checker.getUnionType` API.
 */
function resolveTemplateValueType(
	type: ts.Type,
	checker: ts.TypeChecker,
	resolve: (type: ts.Type) => AnyType,
): AnyType {
	if (type.isUnion()) {
		return new UnionNode(
			undefined,
			type.types.map((t) => resolve(resolveTypeParamDefault(t, checker))),
		);
	}
	return resolve(resolveTypeParamDefault(type, checker));
}

export function parseObjectType(
	type: ts.Type,
	typeName: TypeName | undefined,
	context: ParserContext,
	resolveValueType?: (
		type: ts.Type,
		typeNode: ts.TypeNode | undefined,
		context: ParserContext,
	) => AnyType,
): ObjectNode | undefined {
	const { shouldInclude, shouldResolveObject, typeStack, includeExternalTypes } = context;

	const properties = type
		.getProperties()
		.filter((property) => includeExternalTypes || !isPropertyExternal(property));

	// Check for index signature even if there are no properties
	const indexSignature = resolveValueType
		? parseIndexSignature(type, context, resolveValueType)
		: undefined;

	// Return an object node if there's either properties or an index signature
	if (properties.length || indexSignature) {
		if (
			shouldResolveObject({
				name: typeName?.name ?? '',
				propertyCount: properties.length,
				depth: typeStack.length,
			})
		) {
			let filteredProperties: ts.Symbol[];
			if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) {
				filteredProperties = properties;
			} else {
				filteredProperties = properties.filter((property) => {
					// Skip ECMAScript private identifiers (#field)
					if (property.getName().startsWith('#')) {
						return false;
					}

					const declaration =
						property.valueDeclaration ??
						(property.declarations?.[0] as
							| ts.PropertySignature
							| ts.MethodSignature
							| ts.PropertyAssignment
							| ts.PropertyDeclaration
							| ts.ShorthandPropertyAssignment
							| undefined);

					if (!declaration) {
						return false;
					}

					// Skip private/protected class members
					if (ts.isPropertyDeclaration(declaration) && ts.canHaveModifiers(declaration)) {
						const modifiers = ts.getModifiers(declaration);
						if (
							modifiers?.some(
								(m) =>
									m.kind === ts.SyntaxKind.PrivateKeyword ||
									m.kind === ts.SyntaxKind.ProtectedKeyword ||
									m.kind === ts.SyntaxKind.StaticKeyword,
							)
						) {
							return false;
						}
					}

					return (
						(ts.isPropertySignature(declaration) ||
							ts.isMethodSignature(declaration) ||
							ts.isPropertyAssignment(declaration) ||
							ts.isPropertyDeclaration(declaration) ||
							ts.isShorthandPropertyAssignment(declaration)) &&
						shouldInclude({ name: property.getName(), depth: typeStack.length + 1 })
					);
				});
			}

			if (filteredProperties.length > 0 || indexSignature) {
				return new ObjectNode(
					typeName,
					filteredProperties.map((property) => {
						const declaration = property.valueDeclaration ?? property.declarations?.[0];
						// MethodSignature uses checker.getTypeOfSymbol fallback in parseProperty
						const propertySignature =
							declaration && ts.isPropertySignature(declaration) ? declaration : undefined;
						return parseProperty(property, propertySignature, context);
					}),
					undefined,
					indexSignature,
				);
			}
		}

		return new ObjectNode(typeName, [], undefined, indexSignature);
	}
}

function isPropertyExternal(property: ts.Symbol): boolean {
	return (
		property.declarations?.every((declaration) =>
			declaration.getSourceFile().fileName.includes('node_modules'),
		) ?? false
	);
}
