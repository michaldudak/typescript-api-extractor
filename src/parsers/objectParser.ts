import ts from 'typescript';
import { parseProperty } from './propertyParser';
import { ParserContext } from '../parser';
import { ObjectNode } from '../models';
import { getTypeName, getTypeNamespaces } from './typeResolver';

export function parseObjectType(
	type: ts.Type,
	context: ParserContext,
	skipResolvingComplexTypes: boolean,
): ObjectNode | undefined {
	const { shouldInclude, shouldResolveObject, typeStack, includeExternalTypes, checker } = context;

	const properties = type
		.getProperties()
		.filter((property) => includeExternalTypes || !isPropertyExternal(property));

	const typeName = getTypeName(type, undefined, checker, false);

	if (properties.length) {
		if (
			!skipResolvingComplexTypes &&
			shouldResolveObject({
				name: typeName ?? '',
				propertyCount: properties.length,
				depth: typeStack.length,
			})
		) {
			const filteredProperties = properties.filter((property) => {
				const declaration =
					property.valueDeclaration ??
					(property.declarations?.[0] as ts.PropertySignature | undefined);
				return (
					declaration &&
					ts.isPropertySignature(declaration) &&
					shouldInclude({ name: property.getName(), depth: typeStack.length + 1 })
				);
			});
			if (filteredProperties.length > 0) {
				return new ObjectNode(
					typeName,
					getTypeNamespaces(type),
					filteredProperties.map((property) => {
						return parseProperty(
							property,
							property.valueDeclaration as ts.PropertySignature,
							context,
						);
					}),
					undefined,
				);
			}
		}

		return new ObjectNode(typeName ?? undefined, getTypeNamespaces(type), [], undefined);
	}
}

function isPropertyExternal(property: ts.Symbol): boolean {
	return (
		property.declarations?.every((declaration) =>
			declaration.getSourceFile().fileName.includes('node_modules'),
		) ?? false
	);
}
