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

		// `as` clauses rename keys (e.g. `[K in keyof T as `prefix_${K}`]`); the resulting
		// key shape can't be represented as a plain index signature, so fall through.
		if (mappedNode && mappedNode.type && !mappedNode.nameType) {
			const templateType = checker.getTypeAtLocation(mappedNode.type);
			const constraintNode = mappedNode.typeParameter.constraint;
			const constraintType = constraintNode
				? (checker.getBaseConstraintOfType(checker.getTypeAtLocation(constraintNode)) ??
					checker.getTypeAtLocation(constraintNode))
				: undefined;

			if (constraintType) {
				let keyType: 'string' | 'number' | undefined;
				if (constraintType.flags & ts.TypeFlags.String) {
					keyType = 'string';
				} else if (constraintType.flags & ts.TypeFlags.Number) {
					keyType = 'number';
				}

				if (keyType) {
					let valueType = resolveTemplateValueType(templateType, type, checker, (t) =>
						resolveValueType(t, undefined, context),
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

// Mapped-type templates resolved through the AST keep type parameters unresolved
// (e.g. `V` in `{ [K in string]: V }`). To surface the user-meant type, first try
// substituting through the instantiated mapped type's `aliasTypeArguments` (so a
// reuse like `Wrapped<K, V> = ReadonlyArray<MapAlias<K, V>>` propagates `Wrapped`'s
// `V` rather than collapsing to `MapAlias`'s declared default), and fall back to
// the type parameter's own declared default when no alias substitution applies.
function resolveTemplateTypeParam(
	type: ts.Type,
	mappedType: ts.Type,
	checker: ts.TypeChecker,
): ts.Type {
	if (!(type.flags & ts.TypeFlags.TypeParameter)) {
		return type;
	}

	const aliasArgs = mappedType.aliasTypeArguments;
	const aliasSymbol = mappedType.aliasSymbol;
	if (aliasArgs && aliasSymbol) {
		const aliasDecl = aliasSymbol.declarations?.find((d) => ts.isTypeAliasDeclaration(d));
		if (aliasDecl?.typeParameters) {
			// Match by declaration symbol — `getSymbolAtLocation`/`getTypeAtLocation`
			// can throw on parameter declarations in unusual binding states.
			const idx = aliasDecl.typeParameters.findIndex(
				(tp) => (tp as ts.TypeParameterDeclaration & { symbol?: ts.Symbol }).symbol === type.symbol,
			);
			if (idx >= 0 && idx < aliasArgs.length) {
				const substituted = aliasArgs[idx];
				if (substituted !== type) {
					// Substitution can yield another type parameter (outer alias's own
					// parameter); recurse so its default still applies.
					return resolveTemplateTypeParam(substituted, mappedType, checker);
				}
			}
		}
	}

	const declaration = type.symbol?.declarations?.[0];
	if (declaration && ts.isTypeParameterDeclaration(declaration) && declaration.default) {
		return checker.getTypeAtLocation(declaration.default);
	}
	return type;
}

/**
 * Resolve a mapped-type template into a model-level type, substituting type
 * parameters via the instantiated mapped type's alias arguments (with declared
 * defaults as a fallback). Unions are expanded per-member and rebuilt as a
 * model `UnionNode`, avoiding reliance on the internal `checker.getUnionType` API.
 */
function resolveTemplateValueType(
	type: ts.Type,
	mappedType: ts.Type,
	checker: ts.TypeChecker,
	resolve: (type: ts.Type) => AnyType,
): AnyType {
	if (type.isUnion()) {
		return new UnionNode(
			undefined,
			type.types.map((t) => resolve(resolveTemplateTypeParam(t, mappedType, checker))),
		);
	}
	return resolve(resolveTemplateTypeParam(type, mappedType, checker));
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
