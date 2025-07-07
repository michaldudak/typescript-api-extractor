import ts from 'typescript';
import { parseProperty } from './propertyParser';
import { ParserContext } from '../parser';
import { ObjectNode, TypeName } from '../models';

export function parseObjectType(
	type: ts.Type,
	typeName: TypeName | undefined,
	context: ParserContext,
): ObjectNode | undefined {
	const { shouldInclude, shouldResolveObject, typeStack, includeExternalTypes } = context;

	const properties = type
		.getProperties()
		.filter((property) => includeExternalTypes || !isPropertyExternal(property));

	if (properties.length) {
		if (
			shouldResolveObject({
				name: typeName?.name ?? '',
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

		return new ObjectNode(typeName, [], undefined);
	}
}

function isPropertyExternal(property: ts.Symbol): boolean {
	return (
		property.declarations?.every((declaration) =>
			declaration.getSourceFile().fileName.includes('node_modules'),
		) ?? false
	);
}
