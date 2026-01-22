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
	if (!(type.flags & ts.TypeFlags.Object)) {
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

	return undefined;
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
					const declaration =
						property.valueDeclaration ??
						(property.declarations?.[0] as ts.PropertySignature | ts.MethodSignature | undefined);
					return (
						declaration &&
						(ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration)) &&
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
