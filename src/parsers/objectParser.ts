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
		// AST-driven: instantiated mapped types and ones loaded from `.d.ts` may not
		// retain a `MappedTypeNode` declaration, in which case we fall through and
		// emit no index signature — same outcome as "genuinely no index signature".
		const mappedNode = type.symbol?.declarations?.find(ts.isMappedTypeNode);
		const substitutions = getMappedTypeParameterSubstitutions(type);

		// `as` clauses rename keys (e.g. `[K in keyof T as `prefix_${K}`]`); the resulting
		// key shape can't be represented as a plain index signature, so fall through.
		if (mappedNode && mappedNode.type && !mappedNode.nameType) {
			const templateType = checker.getTypeAtLocation(mappedNode.type);
			const constraintNode = mappedNode.typeParameter.constraint;
			const constraintNodeType = constraintNode
				? substituteTypeParameter(checker.getTypeAtLocation(constraintNode), substitutions)
				: undefined;
			const constraintType = constraintNodeType
				? (checker.getBaseConstraintOfType(constraintNodeType) ?? constraintNodeType)
				: undefined;

			if (constraintType) {
				let keyType: 'string' | 'number' | undefined;
				if (constraintType.flags & ts.TypeFlags.String) {
					keyType = 'string';
				} else if (constraintType.flags & ts.TypeFlags.Number) {
					keyType = 'number';
				}

				if (keyType) {
					let valueType = resolveTemplateValueType(
						templateType,
						context,
						resolveValueType,
						substitutions,
					);
					// `?`/`+?` adds `undefined` to the value type. `-?` and no modifier
					// leave it alone. Whitelist the additive forms so future TS modifier
					// kinds don't get treated as `?`.
					const questionToken = mappedNode.questionToken;
					if (
						questionToken &&
						(questionToken.kind === ts.SyntaxKind.QuestionToken ||
							questionToken.kind === ts.SyntaxKind.PlusToken)
					) {
						valueType = new UnionNode(undefined, [valueType, new IntrinsicNode('undefined')]);
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

type TypeMapperLike = {
	source?: ts.Type;
	target?: ts.Type;
	sources?: readonly ts.Type[];
	targets?: readonly ts.Type[];
	mapper1?: unknown;
	mapper2?: unknown;
};

// TypeScript does not expose instantiated mapped-type substitutions publicly.
// Read the mapper defensively: if its shape changes, we simply get no substitutions.
function getMappedTypeParameterSubstitutions(type: ts.Type): Map<ts.Symbol, ts.Type> {
	const substitutions = new Map<ts.Symbol, ts.Type>();
	const seen = new WeakSet<object>();
	collectTypeParameterSubstitutions((type as { mapper?: unknown }).mapper, substitutions, seen);
	return substitutions;
}

function collectTypeParameterSubstitutions(
	mapper: unknown,
	substitutions: Map<ts.Symbol, ts.Type>,
	seen: WeakSet<object>,
): void {
	if (!mapper || typeof mapper !== 'object' || seen.has(mapper)) {
		return;
	}
	seen.add(mapper);

	const mapperLike = mapper as TypeMapperLike;
	if (isType(mapperLike.source) && isType(mapperLike.target)) {
		addTypeParameterSubstitution(mapperLike.source, mapperLike.target, substitutions);
	}

	if (mapperLike.sources && mapperLike.targets) {
		for (let index = 0; index < mapperLike.sources.length; index += 1) {
			const source = mapperLike.sources[index];
			const target = mapperLike.targets[index];
			if (isType(source) && isType(target)) {
				addTypeParameterSubstitution(source, target, substitutions);
			}
		}
	}

	collectTypeParameterSubstitutions(mapperLike.mapper1, substitutions, seen);
	collectTypeParameterSubstitutions(mapperLike.mapper2, substitutions, seen);
}

function isType(value: unknown): value is ts.Type {
	return Boolean(value && typeof value === 'object' && 'flags' in value);
}

function addTypeParameterSubstitution(
	source: ts.Type,
	target: ts.Type,
	substitutions: Map<ts.Symbol, ts.Type>,
): void {
	if (!(source.flags & ts.TypeFlags.TypeParameter) || !source.symbol) {
		return;
	}
	substitutions.set(source.symbol, target);
}

function substituteTypeParameter(
	type: ts.Type,
	substitutions: Map<ts.Symbol, ts.Type>,
	seen: Set<ts.Symbol> = new Set(),
): ts.Type {
	if (!(type.flags & ts.TypeFlags.TypeParameter)) {
		return type;
	}

	const substitution = type.symbol ? substitutions.get(type.symbol) : undefined;
	if (
		!substitution ||
		substitution === type ||
		(substitution.flags & ts.TypeFlags.TypeParameter && substitution.symbol === type.symbol)
	) {
		return type;
	}
	if (type.symbol && seen.has(type.symbol)) {
		return type;
	}
	if (type.symbol) {
		seen.add(type.symbol);
	}

	return substituteTypeParameter(substitution, substitutions, seen);
}

/**
 * Resolve a mapped-type template with the instantiated mapped type's type-parameter
 * mapper, so wrapper aliases propagate their type arguments through nested values.
 */
function resolveTemplateValueType(
	type: ts.Type,
	context: ParserContext,
	resolve: (type: ts.Type, typeNode: ts.TypeNode | undefined, context: ParserContext) => AnyType,
	substitutions: Map<ts.Symbol, ts.Type>,
): AnyType {
	return resolve(type, undefined, {
		...context,
		typeParameterSubstitutions: substitutions,
	});
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
