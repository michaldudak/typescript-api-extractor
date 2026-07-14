import ts from 'typescript';
import { getDocumentationFromSymbol } from '../documentationParser';
import { type ScopedParserContext } from '../../parserContext';
import {
	ObjectNode,
	TypeName,
	IndexSignatureNode,
	AnyType,
	IntrinsicNode,
	PropertyNode,
	UnionNode,
} from '../../models';
import { ParserError } from '../../ParserError';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';
import {
	getMappedTypeParameterSubstitutions,
	substituteTypeParameter,
} from './mappedTypeSubstitutions';
import { containsKeyofTypeOperatorOrAlias } from './typeOperatorTypeNodes';

// Object-like type handling lives in one resolver module. The
// exported resolver owns object-shape selection and object-keyword fallback,
// while private helpers build properties, index signatures, and mapped-type
// details with the active resolution session.

export function resolveObjectLikeType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const objectType = buildObjectNodeFromType(
		type,
		typeName,
		session.context,
		session.resolveWithContext,
	);
	if (objectType) {
		return objectType;
	}

	const { checker } = session.context;
	if (
		hasExactFlag(type, ts.TypeFlags.Object) ||
		(hasExactFlag(type, ts.TypeFlags.NonPrimitive) && checker.typeToString(type) === 'object')
	) {
		return new ObjectNode(typeName, [], undefined);
	}

	return undefined;
}

/**
 * Returns whether a plain object can skip the earlier array, tuple, callable,
 * and constructable resolver paths without changing which shape owns it.
 */
export function canResolveObjectTypeShallowly(type: ts.Type, checker: ts.TypeChecker): boolean {
	return (
		isObjectType(type) &&
		!checker.isArrayType(type) &&
		!checker.isTupleType(type) &&
		type.getCallSignatures().length === 0 &&
		type.getConstructSignatures().length === 0
	);
}

/** Builds the named portion of an object while retaining observable index-signature output. */
export function resolveShallowObjectLikeType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): ObjectNode | undefined {
	if (!typeName || !canResolveObjectTypeShallowly(type, session.context.checker)) {
		return undefined;
	}

	return new ObjectNode(
		typeName,
		[],
		undefined,
		buildIndexSignatureNode(type, session.context, session.resolveWithContext),
	);
}

/**
 * Builds the index signature of an object type if it has one. This only works
 * for actual object types; conditional and other non-object shapes are selected
 * by resolver adapters before this builder is called.
 */
function buildIndexSignatureNode(
	type: ts.Type,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): IndexSignatureNode | undefined {
	const { checker } = context;

	// Only check index signatures on actual object types
	// Conditional types and other non-object types may report index signatures incorrectly
	if (!isObjectType(type)) {
		return undefined;
	}
	const mappedNode =
		type.objectFlags & ts.ObjectFlags.Mapped
			? type.symbol?.declarations?.find(ts.isMappedTypeNode)
			: undefined;
	const mappedSubstitutions = mappedNode ? getMappedTypeParameterSubstitutions(type) : undefined;
	const stringIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.String);
	const numberIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.Number);
	const mappedTemplateContainsKeyof = Boolean(
		mappedNode?.type && containsKeyofTypeOperatorOrAlias(mappedNode.type, checker),
	);
	const mappedIndexSignature =
		mappedNode &&
		mappedSubstitutions &&
		(mappedTemplateContainsKeyof || (!stringIndexInfo && !numberIndexInfo))
			? buildMappedIndexSignatureNode(
					type,
					mappedNode,
					mappedSubstitutions,
					context,
					resolveValueType,
				)
			: undefined;
	if (mappedIndexSignature) {
		return mappedIndexSignature;
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
	if (stringIndexInfo) {
		return {
			keyName: getKeyName(stringIndexInfo),
			keyType: 'string',
			valueType: resolveValueType(
				stringIndexInfo.type,
				getIndexValueTypeNode(stringIndexInfo, checker),
				context,
			),
		};
	}

	// Then try number index
	if (numberIndexInfo) {
		return {
			keyName: getKeyName(numberIndexInfo),
			keyType: 'number',
			valueType: resolveValueType(
				numberIndexInfo.type,
				getIndexValueTypeNode(numberIndexInfo, checker),
				context,
			),
		};
	}

	return undefined;
}

function buildMappedIndexSignatureNode(
	type: ts.ObjectType,
	mappedNode: ts.MappedTypeNode,
	substitutions: Map<ts.Symbol, ts.Type>,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): IndexSignatureNode | undefined {
	const { checker } = context;
	// `as` clauses rename keys (e.g. `[K in keyof T as `prefix_${K}`]`); the resulting
	// key shape can't be represented as a plain index signature, so fall through.
	if (!mappedNode.type || mappedNode.nameType) {
		return undefined;
	}

	const constraintNode = mappedNode.typeParameter.constraint;
	const constraintNodeType = constraintNode
		? substituteTypeParameter(checker.getTypeAtLocation(constraintNode), substitutions)
		: undefined;
	const constraintType = constraintNodeType
		? (checker.getBaseConstraintOfType(constraintNodeType) ?? constraintNodeType)
		: undefined;
	let keyType: 'string' | 'number' | undefined;
	if (constraintType && constraintType.flags & ts.TypeFlags.String) {
		keyType = 'string';
	} else if (constraintType && constraintType.flags & ts.TypeFlags.Number) {
		keyType = 'number';
	}
	if (!keyType) {
		return undefined;
	}

	const indexInfo = checker.getIndexInfoOfType(
		type,
		keyType === 'string' ? ts.IndexKind.String : ts.IndexKind.Number,
	);
	const templateType = indexInfo?.type ?? checker.getTypeAtLocation(mappedNode.type);
	const templateTypeNode = containsKeyofTypeOperatorOrAlias(mappedNode.type, checker)
		? mappedNode.type
		: undefined;
	let valueType = resolveTemplateValueType(
		templateType,
		templateTypeNode,
		context,
		resolveValueType,
		substitutions,
	);
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

function getIndexValueTypeNode(
	indexInfo: ts.IndexInfo,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const declaration = indexInfo.declaration;
	return declaration &&
		ts.isIndexSignatureDeclaration(declaration) &&
		containsKeyofTypeOperatorOrAlias(declaration.type, checker)
		? declaration.type
		: undefined;
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
	return Boolean(type.flags & ts.TypeFlags.Object);
}

/**
 * Resolve a mapped-type template with the instantiated mapped type's type-parameter
 * mapper, so wrapper aliases propagate their type arguments through nested values.
 */
function resolveTemplateValueType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ScopedParserContext,
	resolve: (
		type: ts.Type,
		typeNode: ts.TypeNode | undefined,
		context: ScopedParserContext,
	) => AnyType,
	substitutions: Map<ts.Symbol, ts.Type>,
): AnyType {
	const typeParameterSubstitutions = new Map(context.typeParameterSubstitutions);
	for (const [symbol, substitution] of substitutions) {
		typeParameterSubstitutions.set(symbol, substitution);
	}

	return context.runWithTypeParameterSubstitutionScope(typeParameterSubstitutions, () =>
		resolve(type, typeNode, context),
	);
}

/**
 * Builds an ObjectNode for a type that the resolver pipeline is treating as an
 * object-like shape. Member value types use the active resolver callback so
 * nested properties remain in the same resolution session.
 */
function buildObjectNodeFromType(
	type: ts.Type,
	typeName: TypeName | undefined,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): ObjectNode | undefined {
	const { shouldInclude, shouldResolveObject, typeStack, includeExternalTypes } = context;
	const mappedNode =
		isObjectType(type) && type.objectFlags & ts.ObjectFlags.Mapped
			? type.symbol?.declarations?.find(ts.isMappedTypeNode)
			: undefined;
	const mappedSubstitutions = mappedNode ? getMappedTypeParameterSubstitutions(type) : undefined;

	const properties = type
		.getProperties()
		.filter((property) => includeExternalTypes || !isPropertyExternal(property));

	// Check for index signature even if there are no properties.
	const indexSignature = buildIndexSignatureNode(type, context, resolveValueType);

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
				filteredProperties = properties.filter((property) =>
					shouldInclude({ name: property.getName(), depth: typeStack.length + 1 }),
				);
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
						// MethodSignature uses checker.getTypeOfSymbol fallback in the property builder.
						const propertySignature =
							declaration && ts.isPropertySignature(declaration) ? declaration : undefined;
						return buildPropertyNodeFromSymbol(
							property,
							propertySignature,
							context,
							resolveValueType,
							mappedNode?.type,
							mappedSubstitutions,
						);
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

function buildPropertyNodeFromSymbol(
	propertySymbol: ts.Symbol,
	propertySignature: ts.PropertySignature | undefined,
	context: ScopedParserContext,
	resolvePropertyType: ResolveTypeInContext,
	mappedTemplateTypeNode?: ts.TypeNode,
	mappedSubstitutions?: Map<ts.Symbol, ts.Type>,
): PropertyNode {
	const { checker } = context;

	return context.runWithSymbolScope(`property: ${propertySymbol.name}`, () => {
		try {
			let type: ts.Type;
			const sourceNode =
				propertySignature?.type ?? propertySignature ?? propertySymbol.declarations?.[0];

			return context.runWithSourceNodeScope(sourceNode, () => {
				if (propertySignature) {
					if (propertySignature.type) {
						type = checker.getTypeOfSymbolAtLocation(propertySymbol, propertySignature.type);
					} else {
						type = checker.getAnyType();
					}
				} else {
					type = checker.getTypeOfSymbol(propertySymbol);
				}

				const propertyTypeNode = isTypeParameterLike(type)
					? undefined
					: (propertySignature?.type ?? mappedTemplateTypeNode);
				const parsedType =
					mappedTemplateTypeNode && mappedSubstitutions
						? resolveTemplateValueType(
								type,
								propertyTypeNode,
								context,
								resolvePropertyType,
								mappedSubstitutions,
							)
						: resolvePropertyType(type, propertyTypeNode, context);

				// Typechecker only gives the type "any" if it's present in a union.
				// This means the type of `a` in `{ a?: any }` isn't `any | undefined`.
				// So instead we check for the question mark to detect optional types.
				const isOptional =
					(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) && propertySignature
						? Boolean(propertySignature.questionToken)
						: Boolean(propertySymbol.flags & ts.SymbolFlags.Optional);

				return new PropertyNode(
					propertySymbol.getName(),
					parsedType,
					getDocumentationFromSymbol(propertySymbol, checker),
					isOptional,
				);
			});
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

function isTypeParameterLike(type: ts.Type): boolean {
	// Check if the type is a type parameter.
	return (
		(type.flags & ts.TypeFlags.TypeParameter) !== 0 ||
		((type.flags & ts.TypeFlags.Union) !== 0 && isOptionalTypeParameter(type as ts.UnionType))
	);
}

function isOptionalTypeParameter(type: ts.UnionType): boolean {
	// Check if the type is defined as `foo?: T`, where T is a type parameter.
	return (
		type.types.length === 2 &&
		type.types.some((t) => t.flags & ts.TypeFlags.Undefined) &&
		type.types.some(
			(t) => 'objectFlags' in t && ((t.objectFlags as number) & ts.ObjectFlags.Instantiated) !== 0,
		)
	);
}
