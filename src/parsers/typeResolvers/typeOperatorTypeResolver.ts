import ts from 'typescript';
import {
	IntersectionNode,
	IntrinsicNode,
	LiteralNode,
	ObjectNode,
	TypeOperatorNode,
	TypeQueryNode,
	UnionNode,
	type AnyType,
	type TypeOperatorResolutionKind,
} from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { getFullName } from '../common';
import { reportUnsupportedTypeFallback } from '../typeResolutionDiagnostics';
import { deriveTypeParameterBindings, type TypeParameterBindings } from '../typeParameterBindings';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { areSemanticTypesEquivalent, getKeyofTypeForOperand } from '../typeResolutionUtils';
import { isExternalTypeNode, resolveExternalType } from './externalTypeResolver';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import { canResolveObjectTypeShallowly, resolveShallowObjectLikeType } from './objectTypeResolver';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';
import {
	containsKeyofTypeOperatorOrAlias,
	flattenIntersectionTypeNodes,
	getIndexedAccessKeyofSourceTypeNode,
	getIndexedAccessSourceTypeNode,
	getKeyofTypeOperatorNode,
	getPreservableKeyofTypeNode,
	getTupleNumberIndexedTypeNodes,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Reconstructs authored `keyof` syntax around TypeScript's reduced semantic result.
 *
 * Concrete `keyof Foo` often reaches the resolver as a literal, intrinsic, or
 * literal union, so this syntax-first resolver must run before broad semantic
 * shape resolvers that would discard the operator.
 *
 * @param request - Semantic result, public name, and authored operator/container syntax.
 * @param session - Active resolution session used for the operand and resolved key set.
 * @returns A type-operator model, a containing union, or `undefined` when no operator applies.
 */
export function resolveTypeOperatorType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	if (
		!session.context.includeExternalTypes &&
		isExternalTypeNode(typeNode, session.context.checker)
	) {
		return undefined;
	}
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (!operatorNode) {
		return resolveCollapsedTypeOperatorSyntax(type, typeNode, typeName, session);
	}

	const operandType = session.context.checker.getTypeFromTypeNode(operatorNode.type);
	const undefinedMember = getUndefinedUnionMember(type);
	const collapsedToUndefined = isUndefinedType(type);
	const operand = resolveTypeOperatorOperand(operandType, operatorNode.type, session);
	let typeOperatorNode: TypeOperatorNode;
	if (session.context.typeOperatorOutput === 'syntaxOnly') {
		typeOperatorNode = new TypeOperatorNode(undefined, 'keyof', operand);
	} else {
		const shouldRecomputeInstantiatedResult =
			session.context.typeParameterSubstitutions?.size && !isConcreteKeyofResultType(type);
		const resultType =
			collapsedToUndefined || shouldRecomputeInstantiatedResult
				? getKeyofResultTypeFromSyntax(operatorNode, session.context)
				: type;
		const resolvedResult = resolveTypeOperatorResult(resultType, session, {
			excludeUndefined: Boolean(undefinedMember),
			typeName: shouldRecomputeInstantiatedResult ? undefined : typeName,
		});
		typeOperatorNode = new TypeOperatorNode(
			undefined,
			'keyof',
			operand,
			resolvedResult.type,
			resolvedResult.resolutionKind,
		);
	}

	if (!undefinedMember && !collapsedToUndefined) {
		return typeOperatorNode;
	}

	return new UnionNode(undefined, [typeOperatorNode, new IntrinsicNode('undefined')]);
}

/**
 * Recomputes the semantic result of authored `keyof` syntax under active substitutions.
 *
 * @param operatorNode - Authored `keyof` node whose operand should be evaluated.
 * @param context - Context containing the checker and semantic substitutions.
 * @returns The substituted key type, falling back to the checker's type for the operator node.
 */
export function getKeyofResultTypeFromSyntax(
	operatorNode: ts.TypeOperatorNode,
	context: ScopedParserContext,
): ts.Type {
	const { checker, typeParameterSubstitutions } = context;
	const operandType = checker.getTypeFromTypeNode(operatorNode.type);
	const substitutedOperand = typeParameterSubstitutions
		? substituteTypeParameter(operandType, typeParameterSubstitutions)
		: operandType;
	return (
		getKeyofTypeForOperand(checker, substitutedOperand) ?? checker.getTypeFromTypeNode(operatorNode)
	);
}

function resolveCollapsedTypeOperatorSyntax(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!typeNode) {
		return undefined;
	}

	// TypeScript eagerly reduces operators nested in these containers. Recover
	// the authored branch/property first, then re-enter only syntax-aware
	// resolvers so the reduced semantic type is not mistaken for the whole API.
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		const bindings = getIndexedAccessTypeParameterBindings(unwrapped, session);
		const authoredSubstitutions =
			bindings?.typeNodes ?? session.context.typeParameterTypeNodeSubstitutions;
		const indexType = session.context.checker.getTypeFromTypeNode(unwrapped.indexType);
		const tupleElementTypeNodes =
			indexType.flags & ts.TypeFlags.Number
				? getTupleNumberIndexedTypeNodes(
						unwrapped.objectType,
						session.context.checker,
						session.context.includeExternalTypes,
						authoredSubstitutions,
					)
				: undefined;
		if (
			tupleElementTypeNodes &&
			tupleElementTypeNodes.length > 1 &&
			tupleElementTypeNodes.some((elementTypeNode) =>
				Boolean(
					getPreservableKeyofTypeNode(
						elementTypeNode,
						session.context.checker,
						authoredSubstitutions,
						session.context.includeExternalTypes,
					),
				),
			)
		) {
			const resolveTupleMembers = () => {
				const members = tupleElementTypeNodes.map((elementTypeNode) =>
					resolveAuthoredTypeNode(
						substituteTypeParameterTypeNode(
							elementTypeNode,
							session.context.checker,
							authoredSubstitutions,
						),
						session,
					),
				);
				return new UnionNode(typeName, members);
			};
			return bindings
				? session.context.runWithTypeParameterSubstitutionScope(
						bindings.types,
						resolveTupleMembers,
						bindings.typeNodes,
					)
				: resolveTupleMembers();
		}
		const sourceTypeNode = getIndexedAccessKeyofSourceTypeNode(
			unwrapped,
			session.context.checker,
			session.context.includeExternalTypes,
			authoredSubstitutions,
		);
		if (sourceTypeNode) {
			// A root `keyof` expression has the same semantic result as the indexed access,
			// so its already-instantiated type is a useful override. A containing wrapper
			// such as `Promise<T>` does not: passing the indexed result as its override would
			// replace the wrapper before its substituted type argument can be resolved.
			const resolveSource = () =>
				resolveAuthoredTypeNode(
					sourceTypeNode,
					session,
					getKeyofTypeOperatorNode(sourceTypeNode) ? type : undefined,
				);
			return bindings
				? session.context.runWithTypeParameterSubstitutionScope(
						bindings.types,
						resolveSource,
						bindings.typeNodes,
					)
				: resolveSource();
		}
	}
	if (
		!containsKeyofTypeOperatorOrAlias(
			unwrapped,
			session.context.checker,
			new Set(),
			session.context.includeExternalTypes,
		)
	) {
		return undefined;
	}
	if (ts.isUnionTypeNode(unwrapped)) {
		return resolveAuthoredUnion(type, unwrapped, typeName, session);
	}
	if (ts.isIntersectionTypeNode(unwrapped) && !type.isIntersection()) {
		return resolveAuthoredIntersection(unwrapped, typeName, session);
	}
	if (ts.isConditionalTypeNode(unwrapped) && (type.flags & ts.TypeFlags.Conditional) === 0) {
		return resolveCollapsedConditional(type, unwrapped, typeName, session);
	}
	return undefined;
}

/**
 * Derives the generic bindings visible while following an authored indexed access.
 * Nested indexed objects and alias wrappers are traversed so the selected source
 * property can replay the same arguments as the instantiated semantic result.
 *
 * @param typeNode - Authored indexed access whose object supplies generic arguments.
 * @param session - Active resolution session providing checker and outer substitutions.
 * @param baseBindings - Optional bindings accumulated by an enclosing indexed access.
 * @returns The extended semantic and authored bindings, or `undefined` when none apply.
 */
export function getIndexedAccessTypeParameterBindings(
	typeNode: ts.IndexedAccessTypeNode,
	session: TypeResolutionSession,
	baseBindings?: TypeParameterBindings,
): TypeParameterBindings | undefined {
	const { checker, typeParameterSubstitutions, typeParameterTypeNodeSubstitutions } =
		session.context;
	let bindings =
		baseBindings ??
		(typeParameterSubstitutions?.size || typeParameterTypeNodeSubstitutions?.size
			? {
					types: new Map(typeParameterSubstitutions),
					typeNodes: typeParameterTypeNodeSubstitutions
						? new Map(typeParameterTypeNodeSubstitutions)
						: undefined,
				}
			: undefined);
	const authoredObject = unwrapParenthesizedTypeNode(typeNode.objectType);
	if (ts.isIndexedAccessTypeNode(authoredObject)) {
		bindings = getIndexedAccessTypeParameterBindings(authoredObject, session, bindings) ?? bindings;
		const selectedObjectSource = getIndexedAccessSourceTypeNode(
			authoredObject,
			checker,
			session.context.includeExternalTypes,
			bindings?.typeNodes,
		);
		if (selectedObjectSource) {
			bindings =
				getIndexedAccessAliasChainBindings(selectedObjectSource, checker, bindings, new Set()) ??
				bindings;
		}
		return bindings;
	}

	const aliasBindings = getIndexedAccessAliasChainBindings(
		authoredObject,
		checker,
		bindings,
		new Set(),
	);
	if (aliasBindings !== bindings) {
		return aliasBindings;
	}

	const substitutedObject = substituteTypeParameterTypeNode(
		authoredObject,
		checker,
		bindings?.typeNodes,
	);
	const objectType = checker.getTypeFromTypeNode(substitutedObject);
	const reference =
		objectType.flags & ts.TypeFlags.Object && 'target' in objectType
			? (objectType as ts.TypeReference)
			: undefined;
	const authoredArguments =
		ts.isTypeReferenceNode(substitutedObject) || ts.isImportTypeNode(substitutedObject)
			? substitutedObject.typeArguments
			: undefined;
	const semanticParameters = reference
		? (reference.target as ts.GenericType).typeParameters
		: undefined;
	const semanticArguments = reference
		? checker.getTypeArguments(reference)
		: objectType.aliasTypeArguments;
	if (!semanticParameters?.length || !(authoredArguments?.length || semanticArguments?.length)) {
		return bindings;
	}

	return (
		deriveTypeParameterBindings({
			checker,
			semanticParameters,
			semanticArguments,
			authoredArguments,
			baseTypes: bindings?.types,
			baseTypeNodes: bindings?.typeNodes,
			substituteArgumentTypes: true,
		}) ?? bindings
	);
}

/**
 * Accumulates semantic and authored bindings while following generic alias
 * references that wrap the indexed object. Each inner parameter is rebound to
 * the outer argument before the selected tuple/property syntax is resolved.
 */
function getIndexedAccessAliasChainBindings(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
): TypeParameterBindings | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, baseBindings?.typeNodes);
	const declaration = getReferencedTypeAliasDeclaration(substituted, checker);
	if (!declaration) {
		const genericDeclaration = getReferencedGenericObjectDeclaration(substituted, checker);
		if (!genericDeclaration?.typeParameters?.length) {
			return baseBindings;
		}
		const typeArguments = ts.isTypeReferenceNode(substituted)
			? substituted.typeArguments
			: ts.isImportTypeNode(substituted)
				? substituted.typeArguments
				: undefined;
		return (
			deriveTypeParameterBindings({
				checker,
				declarations: genericDeclaration.typeParameters,
				authoredArguments: typeArguments,
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: genericDeclaration,
			}) ?? baseBindings
		);
	}
	if (seenAliases.has(declaration)) {
		return baseBindings;
	}
	const typeArguments =
		ts.isTypeReferenceNode(substituted) || ts.isImportTypeNode(substituted)
			? substituted.typeArguments
			: undefined;
	const bindings =
		deriveTypeParameterBindings({
			checker,
			declarations: declaration.typeParameters,
			authoredArguments: typeArguments,
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: declaration.type,
		}) ?? baseBindings;
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	return getIndexedAccessAliasChainBindings(declaration.type, checker, bindings, nextSeenAliases);
}

function resolveAuthoredUnion(
	type: ts.Type,
	typeNode: ts.UnionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): UnionNode {
	return new UnionNode(
		typeName,
		typeNode.types.map((memberTypeNode) =>
			resolveAuthoredTypeNode(
				memberTypeNode,
				session,
				getCollapsedUnionOperatorResult(type, memberTypeNode, typeNode, session),
			),
		),
	);
}

/**
 * Finds a generic interface or class referenced by authored syntax, following
 * import aliases. Alias declarations are handled by the recursive chain walker
 * before this terminal lookup.
 */
function getReferencedGenericObjectDeclaration(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.InterfaceDeclaration | ts.ClassDeclaration | undefined {
	const location = ts.isTypeReferenceNode(typeNode)
		? typeNode.typeName
		: ts.isImportTypeNode(typeNode)
			? typeNode.qualifier
			: undefined;
	if (!location) {
		return undefined;
	}
	const symbol = checker.getSymbolAtLocation(location);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(
		(declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration =>
			ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration),
	);
}

function getCollapsedUnionOperatorResult(
	type: ts.Type,
	memberTypeNode: ts.TypeNode,
	unionTypeNode: ts.UnionTypeNode,
	session: TypeResolutionSession,
): ts.Type | undefined {
	if (
		!session.context.typeParameterSubstitutions?.size ||
		!getKeyofTypeOperatorNode(memberTypeNode) ||
		unionTypeNode.types.filter((member) => getKeyofTypeOperatorNode(member)).length !== 1
	) {
		return undefined;
	}

	// Instantiated unions may retain their pre-canonicalization members only on
	// the private `origin`. When exactly one authored member is `keyof`, the sole
	// concrete non-undefined origin member is its semantic result.
	const origin = (type as ts.Type & { origin?: ts.Type }).origin;
	if (!origin?.isUnion()) {
		return undefined;
	}
	const concreteMembers = origin.types.filter(
		(memberType) => !isUndefinedType(memberType) && isConcreteKeyofResultType(memberType),
	);
	return concreteMembers.length === 1 ? concreteMembers[0] : undefined;
}

function resolveAuthoredIntersection(
	typeNode: ts.IntersectionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): IntersectionNode {
	const memberTypeNodes = flattenIntersectionTypeNodes(typeNode) ?? typeNode.types;
	return new IntersectionNode(
		typeName,
		memberTypeNodes.map((memberTypeNode) => resolveAuthoredTypeNode(memberTypeNode, session)),
		[],
	);
}

function resolveCollapsedConditional(
	type: ts.Type,
	typeNode: ts.ConditionalTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType {
	const { checker } = session.context;
	if (isDistributiveConditionalInstantiation(typeNode, session)) {
		return type.isUnion()
			? new UnionNode(
					typeName,
					type.types.map((memberType) => session.resolve(memberType, undefined)),
				)
			: session.resolve(type, undefined);
	}

	const selectedBranch = getConcreteConditionalBranch(typeNode, session);
	if (selectedBranch) {
		return resolveAuthoredTypeNode(selectedBranch, session, type);
	}

	const trueType = getAuthoredTypeNodeType(typeNode.trueType, session);
	const falseType = getAuthoredTypeNodeType(typeNode.falseType, session);
	const trueMatches = areSemanticTypesEquivalent(type, trueType, checker, 'exact');
	const falseMatches = areSemanticTypesEquivalent(type, falseType, checker, 'exact');
	if (trueMatches && falseMatches) {
		// Once substitution makes both authored branches indistinguishable, their
		// syntax cannot identify which branch TypeScript selected. Keep the already
		// instantiated checker result instead of manufacturing both branches.
		return session.resolve(type, undefined);
	}
	if (trueMatches && !falseMatches) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (falseMatches && !trueMatches) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(falseType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (isNeverType(trueType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(type)) {
		if (isNeverType(falseType)) {
			return resolveAuthoredTypeNode(typeNode.falseType, session, type);
		}
		if (isNeverType(trueType)) {
			return resolveAuthoredTypeNode(typeNode.trueType, session, type);
		}
	}

	return new UnionNode(typeName, [
		resolveAuthoredTypeNode(typeNode.trueType, session),
		resolveAuthoredTypeNode(typeNode.falseType, session),
	]);
}

function resolveAuthoredTypeNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
	typeOverride?: ts.Type,
): AnyType {
	const type = typeOverride ?? getAuthoredTypeNodeType(typeNode, session);
	return session.resolveAuthoredSyntax({ type, typeName: undefined, typeNode });
}

function getAuthoredTypeNodeType(typeNode: ts.TypeNode, session: TypeResolutionSession): ts.Type {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	const authoredType = operatorNode
		? getKeyofResultTypeFromSyntax(operatorNode, session.context)
		: session.context.checker.getTypeFromTypeNode(typeNode);
	return session.context.typeParameterSubstitutions
		? substituteTypeParameter(authoredType, session.context.typeParameterSubstitutions)
		: authoredType;
}

function isDistributiveConditionalInstantiation(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): boolean {
	const { checker, typeParameterSubstitutions } = session.context;
	if (!typeParameterSubstitutions?.size) {
		return false;
	}

	const checkType = checker.getTypeFromTypeNode(typeNode.checkType);
	if (!(checkType.flags & ts.TypeFlags.TypeParameter)) {
		return false;
	}

	const substitutedCheckType = substituteTypeParameter(checkType, typeParameterSubstitutions);
	return substitutedCheckType.isUnion() || isNeverType(substitutedCheckType);
}

function getConcreteConditionalBranch(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): ts.TypeNode | undefined {
	const { checker, typeParameterSubstitutions } = session.context;
	const compositeDecision = getFixedTupleConditionalDecision(
		typeNode.checkType,
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
	);
	if (compositeDecision != null) {
		return compositeDecision ? typeNode.trueType : typeNode.falseType;
	}
	const authoredCheckType = checker.getTypeFromTypeNode(typeNode.checkType);
	const authoredExtendsType = checker.getTypeFromTypeNode(typeNode.extendsType);
	if (
		typeParameterSubstitutions?.size &&
		((!(authoredCheckType.flags & ts.TypeFlags.TypeParameter) &&
			typeNodeReferencesSubstitutedParameter(
				typeNode.checkType,
				checker,
				typeParameterSubstitutions,
			)) ||
			(!(authoredExtendsType.flags & ts.TypeFlags.TypeParameter) &&
				typeNodeReferencesSubstitutedParameter(
					typeNode.extendsType,
					checker,
					typeParameterSubstitutions,
				)))
	) {
		return undefined;
	}
	const checkType = typeParameterSubstitutions
		? substituteTypeParameter(authoredCheckType, typeParameterSubstitutions)
		: authoredCheckType;
	const extendsType = typeParameterSubstitutions
		? substituteTypeParameter(authoredExtendsType, typeParameterSubstitutions)
		: authoredExtendsType;
	const unresolvedFlags =
		ts.TypeFlags.Any |
		ts.TypeFlags.Never |
		ts.TypeFlags.TypeParameter |
		ts.TypeFlags.Conditional |
		ts.TypeFlags.Substitution;
	if (checkType.flags & unresolvedFlags || extendsType.flags & unresolvedFlags) {
		return undefined;
	}

	return checker.isTypeAssignableTo(checkType, extendsType)
		? typeNode.trueType
		: typeNode.falseType;
}

/**
 * Decides non-distributive fixed-tuple checks after substituting their element
 * parameters. TypeScript exposes `[T]` as an object type, so the root-only
 * semantic substitution used by ordinary conditionals cannot instantiate it.
 * Restricting this fallback to plain fixed tuples keeps the element-wise
 * assignability test equivalent to the authored tuple relation.
 */
function getFixedTupleConditionalDecision(
	checkTypeNode: ts.TypeNode,
	extendsTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
): boolean | undefined {
	if (!substitutions?.size) {
		return undefined;
	}
	const checkTuple = unwrapParenthesizedTypeNode(checkTypeNode);
	const extendsTuple = unwrapParenthesizedTypeNode(extendsTypeNode);
	if (!ts.isTupleTypeNode(checkTuple) || !ts.isTupleTypeNode(extendsTuple)) {
		return undefined;
	}
	if (
		checkTuple.elements.some(isNonFixedTupleElement) ||
		extendsTuple.elements.some(isNonFixedTupleElement)
	) {
		return undefined;
	}
	if (checkTuple.elements.length !== extendsTuple.elements.length) {
		return false;
	}

	const unresolvedFlags =
		ts.TypeFlags.Any |
		ts.TypeFlags.Never |
		ts.TypeFlags.TypeParameter |
		ts.TypeFlags.Conditional |
		ts.TypeFlags.Substitution;
	for (let index = 0; index < checkTuple.elements.length; index += 1) {
		const checkElementNode = checkTuple.elements[index]!;
		const extendsElementNode = extendsTuple.elements[index]!;
		const authoredCheckType = checker.getTypeFromTypeNode(checkElementNode);
		const authoredExtendsType = checker.getTypeFromTypeNode(extendsElementNode);
		if (
			(!(authoredCheckType.flags & ts.TypeFlags.TypeParameter) &&
				typeNodeReferencesSubstitutedParameter(checkElementNode, checker, substitutions)) ||
			(!(authoredExtendsType.flags & ts.TypeFlags.TypeParameter) &&
				typeNodeReferencesSubstitutedParameter(extendsElementNode, checker, substitutions))
		) {
			return undefined;
		}
		const checkType = substituteTypeParameter(authoredCheckType, substitutions);
		const extendsType = substituteTypeParameter(authoredExtendsType, substitutions);
		if (checkType.flags & unresolvedFlags || extendsType.flags & unresolvedFlags) {
			return undefined;
		}
		if (!checker.isTypeAssignableTo(checkType, extendsType)) {
			return false;
		}
	}
	return true;
}

function isNonFixedTupleElement(typeNode: ts.TypeNode): boolean {
	return (
		ts.isNamedTupleMember(typeNode) ||
		ts.isOptionalTypeNode(typeNode) ||
		ts.isRestTypeNode(typeNode)
	);
}

function typeNodeReferencesSubstitutedParameter(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type>,
): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const symbol = checker.getSymbolAtLocation(node.typeName);
			if (symbol && substitutions.has(symbol)) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
}

function resolveTypeOperatorOperand(
	type: ts.Type,
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
): AnyType {
	const unwrappedTypeNode = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isTypeQueryNode(unwrappedTypeNode)) {
		return new TypeQueryNode(unwrappedTypeNode.exprName.getText());
	}
	if (ts.isImportTypeNode(unwrappedTypeNode) && unwrappedTypeNode.isTypeOf) {
		return new TypeQueryNode(getImportTypeExpressionText(unwrappedTypeNode));
	}

	if (canResolveObjectTypeShallowly(type, session.context.checker)) {
		if (session.isTypeActive(type)) {
			return compactTypeOperatorOperand(session.resolve(type, typeNode));
		}

		const request: TypeResolutionRequest = {
			type,
			typeNode,
			typeName: getFullName(type, typeNode, session.context),
		};
		const externalType = resolveExternalType(request, session);
		if (externalType) {
			return externalType;
		}

		const shallowObject = session.runWithTypeFrame(type, () =>
			resolveShallowObjectLikeType(request, session),
		);
		if (shallowObject) {
			return shallowObject;
		}
	}

	return compactTypeOperatorOperand(session.resolve(type, typeNode));
}

/**
 * Extracts the import expression from a `typeof import(...)` type node.
 *
 * The `typeof` keyword and `import` expression are separate AST tokens even
 * when comments or unusual whitespace appear between them. Slicing from the
 * import token avoids interpreting trivia while retaining authored qualifiers,
 * type arguments, and import attributes.
 *
 * @param typeNode - A `typeof import(...)` node whose query expression is needed.
 * @returns The authored text beginning with the `import` keyword.
 */
function getImportTypeExpressionText(typeNode: ts.ImportTypeNode): string {
	const sourceFile = typeNode.getSourceFile();
	const importToken = typeNode
		.getChildren(sourceFile)
		.find((child) => child.kind === ts.SyntaxKind.ImportKeyword);

	if (!importToken) {
		// Valid ImportTypeNodes always contain this token. Keep malformed or synthetic
		// nodes recoverable without reintroducing a whitespace-sensitive assumption.
		return typeNode
			.getText(sourceFile)
			.replace(/^typeof\b/, '')
			.trimStart();
	}

	return sourceFile.text.slice(importToken.getStart(sourceFile), typeNode.getEnd());
}

function resolveTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	options: { excludeUndefined?: boolean; typeName?: TypeResolutionRequest['typeName'] } = {},
): { type: AnyType; resolutionKind: TypeOperatorResolutionKind } {
	if (type.isUnion()) {
		const memberTypes = options.excludeUndefined
			? type.types.filter((memberType) => !isUndefinedType(memberType))
			: type.types;

		if (memberTypes.length === 1) {
			return resolveTypeOperatorResult(memberTypes[0], session, { typeName: options.typeName });
		}
		const resolvedMembers = memberTypes.map((memberType) =>
			resolveTypeOperatorResult(memberType, session),
		);

		return {
			type: new UnionNode(
				options.typeName,
				resolvedMembers.map((member) => member.type),
			),
			resolutionKind: aggregateResolutionKinds(
				resolvedMembers.map((member) => member.resolutionKind),
			),
		};
	}

	const concreteResult = resolveConcreteTypeOperatorResult(type, session, options.typeName);
	if (concreteResult) {
		return { type: concreteResult, resolutionKind: 'exact' };
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint && baseConstraint !== type) {
		const resolvedConstraint = resolveTypeOperatorResult(baseConstraint, session, {
			typeName: options.typeName,
		});
		return {
			type: resolvedConstraint.type,
			resolutionKind:
				resolvedConstraint.resolutionKind === 'fallback' ? 'fallback' : 'baseConstraint',
		};
	}

	reportUnsupportedTypeFallback(type, undefined, session.context);
	return { type: new IntrinsicNode('any'), resolutionKind: 'fallback' };
}

function aggregateResolutionKinds(
	resolutionKinds: readonly TypeOperatorResolutionKind[],
): TypeOperatorResolutionKind {
	if (resolutionKinds.includes('fallback')) {
		return 'fallback';
	}
	if (resolutionKinds.includes('baseConstraint')) {
		return 'baseConstraint';
	}
	return 'exact';
}

function resolveConcreteTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	typeName: TypeResolutionRequest['typeName'],
): AnyType | undefined {
	if ((type.flags & ts.TypeFlags.Never) !== 0) {
		return new IntrinsicNode('never', typeName);
	}

	if ((type.flags & ts.TypeFlags.String) !== 0) {
		return new IntrinsicNode('string', typeName);
	}

	if ((type.flags & ts.TypeFlags.Number) !== 0) {
		return new IntrinsicNode('number', typeName);
	}

	if ((type.flags & ts.TypeFlags.UniqueESSymbol) !== 0) {
		return session.resolve(type, undefined);
	}

	if ((type.flags & ts.TypeFlags.ESSymbol) !== 0) {
		return new IntrinsicNode('symbol', typeName);
	}

	if (type.isLiteral()) {
		return new LiteralNode(type.isStringLiteral() ? `"${type.value}"` : type.value, typeName);
	}

	return undefined;
}

function compactTypeOperatorOperand(type: AnyType): AnyType {
	if (type instanceof ObjectNode && type.typeName) {
		return new ObjectNode(type.typeName, [], undefined, type.indexSignature);
	}

	return type;
}

function getUndefinedUnionMember(type: ts.Type): ts.Type | undefined {
	if (!type.isUnion()) {
		return undefined;
	}

	return type.types.find(isUndefinedType);
}

function isUndefinedType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Undefined) !== 0;
}

function isNeverType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Never) !== 0;
}

function isConcreteKeyofResultType(type: ts.Type): boolean {
	if (type.isUnion()) {
		return type.types.every(
			(memberType) => isUndefinedType(memberType) || isConcreteKeyofResultType(memberType),
		);
	}

	return (
		(type.flags &
			(ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.ESSymbol |
				ts.TypeFlags.UniqueESSymbol |
				ts.TypeFlags.Literal |
				ts.TypeFlags.Never)) !==
		0
	);
}
