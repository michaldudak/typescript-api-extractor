import ts from 'typescript';
import { parseProperty } from './propertyParser';
import { ParserContext } from '../parser';
import { ObjectNode, TypeName, IndexSignatureNode, AnyType } from '../models';

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
	if (type.objectFlags & ts.ObjectFlags.Mapped && isMappedType(type)) {
		const { typeParameter: typeParam, templateType } = type;

		if (typeParam && templateType) {
			const constraintType = checker.getBaseConstraintOfType(typeParam);
			if (constraintType) {
				let keyType: 'string' | 'number' | undefined;
				if (constraintType.flags & ts.TypeFlags.String) {
					keyType = 'string';
				} else if (constraintType.flags & ts.TypeFlags.Number) {
					keyType = 'number';
				}

				if (keyType) {
					return {
						keyName: typeParam.symbol?.name,
						keyType,
						valueType: resolveValueType(
							resolveTypeParamDefault(templateType, checker),
							undefined,
							context,
						),
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

interface MappedTypeInternal extends ts.ObjectType {
	typeParameter?: ts.TypeParameter;
	templateType?: ts.Type;
}

/**
 * Narrows a mapped object type to expose TypeScript's internal `typeParameter`
 * and `templateType` fields. These are not part of the public API, so we check
 * for them explicitly; if a future TS version removes them, the caller safely
 * sees `undefined` instead of mis-parsing.
 */
function isMappedType(type: ts.ObjectType): type is MappedTypeInternal {
	return 'typeParameter' in type && 'templateType' in type;
}

function resolveTypeParamDefault(type: ts.Type, checker: ts.TypeChecker): ts.Type {
	if (type.flags & ts.TypeFlags.TypeParameter) {
		const declaration = type.symbol?.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
		if (declaration?.default) {
			return checker.getTypeAtLocation(declaration.default);
		}
		return type;
	}
	if (type.isUnion()) {
		const substituted = type.types.map((t) => resolveTypeParamDefault(t, checker));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (checker as any).getUnionType(substituted) as ts.Type;
	}
	return type;
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
