import ts from 'typescript';
import { TypeName, withTypeName, type AnyType } from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import {
	containsKeyofTypeOperator,
	containsKeyofTypeOperatorOrAlias,
	isRelativeImportedTypeReference,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

interface AuthoredTypeAliasReference {
	declaration: ts.TypeAliasDeclaration;
	typeArgumentNodes?: readonly ts.TypeNode[];
	typeArguments?: readonly ts.Type[];
}

interface AliasParameterSubstitutions {
	types: Map<ts.Symbol, ts.Type>;
	typeNodes?: Map<ts.Symbol, ts.TypeNode>;
}

const activeAliasResolutions = new WeakMap<TypeResolutionSession, Set<ts.TypeAliasDeclaration>>();

/**
 * Replays an authored alias body when it contains `keyof`, including through
 * another alias. TypeScript often reduces the semantic type to an array, tuple,
 * union, or conditional branch before the normal shape resolver sees the
 * operator syntax.
 */
export function resolveAuthoredKeyofAlias(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const semanticDeclaration = request.type.aliasSymbol?.declarations?.find(
		ts.isTypeAliasDeclaration,
	);
	const authoredSourceFile =
		semanticDeclaration?.getSourceFile() ?? request.typeNode?.getSourceFile();
	if (
		authoredSourceFile &&
		!session.context.includeExternalTypes &&
		session.context.program.isSourceFileFromExternalLibrary(authoredSourceFile)
	) {
		return undefined;
	}
	const checker = session.context.checker;
	const reference = getAuthoredAliasReference(request, checker);
	const substitutions = reference
		? getTypeAliasParameterSubstitutions(reference, session.context)
		: undefined;
	const replaysAuthoredArgument = Boolean(
		reference &&
		substitutions?.typeNodes &&
		aliasBodyUsesKeyofTypeNodeSubstitution(
			reference.declaration.type,
			substitutions.typeNodes,
			checker,
			session.context.includeExternalTypes,
		),
	);
	const semanticAliasContainsKeyof =
		semanticDeclaration &&
		(typeAliasContainsKeyofInSource(
			semanticDeclaration,
			new Set(),
			session.context.includeExternalTypes,
		) ||
			typeAliasContainsKeyof(
				semanticDeclaration,
				checker,
				new Set(),
				session.context.includeExternalTypes,
			));
	const authoredNodeContainsKeyof =
		typeNodeContainsKeyofAliasInSource(request.typeNode, session.context.includeExternalTypes) ||
		containsKeyofTypeOperatorOrAlias(
			request.typeNode,
			checker,
			new Set(),
			session.context.includeExternalTypes,
		);
	if (!semanticAliasContainsKeyof && !authoredNodeContainsKeyof && !replaysAuthoredArgument) {
		return undefined;
	}
	if (!canCollapseAuthoredKeyofAlias(request.type, checker)) {
		return undefined;
	}

	if (
		!reference ||
		(!replaysAuthoredArgument &&
			(!typeAliasContainsKeyof(
				reference.declaration,
				checker,
				new Set(),
				session.context.includeExternalTypes,
			) ||
				!aliasNeedsSyntaxReplay(
					reference.declaration,
					checker,
					new Set(),
					session.context.includeExternalTypes,
				)))
	) {
		return undefined;
	}

	let activeAliases = activeAliasResolutions.get(session);
	if (!activeAliases) {
		activeAliases = new Set();
		activeAliasResolutions.set(session, activeAliases);
	}
	if (activeAliases.has(reference.declaration)) {
		return undefined;
	}

	const typeName = getOuterAliasTypeName(request, reference.declaration);
	const resolveAliasBody = () => {
		activeAliases.add(reference.declaration);
		try {
			const replayTypeNode = substituteTypeParameterTypeNode(
				reference.declaration.type,
				checker,
				substitutions?.typeNodes,
			);
			const resolvedType = session.context.runWithSourceNodeScope(reference.declaration.type, () =>
				session.resolveWithSyntax({
					...request,
					typeName,
					typeNode: replayTypeNode,
				}),
			);
			return resolvedType && typeName ? withTypeName(resolvedType, typeName) : resolvedType;
		} finally {
			activeAliases.delete(reference.declaration);
		}
	};

	return substitutions
		? session.context.runWithTypeParameterSubstitutionScope(
				substitutions.types,
				resolveAliasBody,
				substitutions.typeNodes,
			)
		: resolveAliasBody();
}

function aliasBodyUsesKeyofTypeNodeSubstitution(
	typeNode: ts.TypeNode,
	substitutions: Map<ts.Symbol, ts.TypeNode>,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const substituted = substituteTypeParameterTypeNode(node, checker, substitutions);
			if (
				substituted !== node &&
				containsKeyofTypeOperatorOrAlias(substituted, checker, new Set(), includeExternalTypes)
			) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
}

/**
 * Checks a root alias chain using source declarations only. This deliberately
 * avoids checker symbol queries so export normalization cannot perturb
 * TypeScript's lazy type caches before ordered type resolution begins.
 */
export function typeAliasContainsKeyofInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);
	if (
		!includeExternalTypes &&
		/[\\/]node_modules[\\/]/.test(declaration.getSourceFile().fileName)
	) {
		return false;
	}
	return typeNodeContainsKeyofInSource(declaration.type, seen, includeExternalTypes);
}

function typeNodeContainsKeyofInSource(
	typeNode: ts.TypeNode,
	seen: Set<ts.TypeAliasDeclaration>,
	includeExternalTypes: boolean,
): boolean {
	if (containsKeyofTypeOperator(typeNode)) {
		return true;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (ts.isArrayTypeNode(unwrapped)) {
		return typeNodeContainsKeyofInSource(unwrapped.elementType, seen, includeExternalTypes);
	}
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped.elements.some((element) =>
			typeNodeContainsKeyofInSource(element, seen, includeExternalTypes),
		);
	}
	if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
		return unwrapped.types.some((member) =>
			typeNodeContainsKeyofInSource(member, seen, includeExternalTypes),
		);
	}

	const referencedDeclaration = findLocalTypeAliasDeclaration(unwrapped);
	return referencedDeclaration
		? typeAliasContainsKeyofInSource(referencedDeclaration, seen, includeExternalTypes)
		: false;
}

/** Identifies a source-only alias chain that needs checker-backed project-reference resolution. */
export function typeAliasReferencesProjectImportInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): boolean {
	if (
		seen.has(declaration) ||
		/[\\/]node_modules[\\/]/.test(declaration.getSourceFile().fileName)
	) {
		return false;
	}
	seen.add(declaration);

	const typeNode = unwrapParenthesizedTypeNode(declaration.type);
	if (ts.isImportTypeNode(typeNode)) {
		return ts.isLiteralTypeNode(typeNode.argument) && ts.isStringLiteral(typeNode.argument.literal);
	}
	if (!ts.isTypeReferenceNode(typeNode)) {
		return false;
	}
	const localDeclaration = findLocalTypeAliasDeclaration(typeNode);
	return localDeclaration
		? typeAliasReferencesProjectImportInSource(localDeclaration, seen)
		: isProjectReferenceCandidateInSource(typeNode);
}

function isProjectReferenceCandidateInSource(typeNode: ts.TypeReferenceNode): boolean {
	if (isRelativeImportedTypeReference(typeNode)) {
		return true;
	}

	let rootName = typeNode.typeName;
	while (ts.isQualifiedName(rootName)) {
		rootName = rootName.left;
	}
	if (!ts.isIdentifier(rootName)) {
		return false;
	}

	return typeNode.getSourceFile().statements.some((statement) => {
		if (ts.isImportEqualsDeclaration(statement)) {
			return statement.name.text === rootName.text;
		}
		if (ts.isModuleDeclaration(statement)) {
			return ts.isIdentifier(statement.name) && statement.name.text === rootName.text;
		}
		if (!ts.isImportDeclaration(statement) || !statement.importClause) {
			return false;
		}

		const { importClause } = statement;
		if (importClause.name?.text === rootName.text) {
			return true;
		}
		const bindings = importClause.namedBindings;
		return bindings && ts.isNamespaceImport(bindings)
			? bindings.name.text === rootName.text
			: Boolean(
					bindings &&
					ts.isNamedImports(bindings) &&
					bindings.elements.some((element) => element.name.text === rootName.text),
				);
	});
}

function typeNodeContainsKeyofAliasInSource(
	typeNode: ts.TypeNode | undefined,
	includeExternalTypes: boolean,
): boolean {
	if (!typeNode) {
		return false;
	}
	if (containsKeyofTypeOperator(typeNode)) {
		return true;
	}

	const declaration = findLocalTypeAliasDeclaration(typeNode);
	return declaration
		? typeAliasContainsKeyofInSource(declaration, new Set(), includeExternalTypes)
		: false;
}

function findLocalTypeAliasDeclaration(typeNode: ts.TypeNode): ts.TypeAliasDeclaration | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) {
		return undefined;
	}
	const referencedName = unwrapped.typeName.text;
	return unwrapped
		.getSourceFile()
		.statements.find(
			(statement): statement is ts.TypeAliasDeclaration =>
				ts.isTypeAliasDeclaration(statement) && statement.name.text === referencedName,
		);
}

function canCollapseAuthoredKeyofAlias(type: ts.Type, checker: ts.TypeChecker): boolean {
	return (
		checker.isArrayType(type) ||
		checker.isTupleType(type) ||
		Boolean(type.flags & ts.TypeFlags.Object) ||
		type.isUnion() ||
		type.isIntersection() ||
		(type.flags &
			(ts.TypeFlags.Any |
				ts.TypeFlags.Unknown |
				ts.TypeFlags.Conditional |
				ts.TypeFlags.Index |
				ts.TypeFlags.IndexedAccess |
				ts.TypeFlags.TemplateLiteral |
				ts.TypeFlags.Literal |
				ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.ESSymbol |
				ts.TypeFlags.UniqueESSymbol |
				ts.TypeFlags.Never |
				ts.TypeFlags.Undefined)) !==
			0
	);
}

function aliasNeedsSyntaxReplay(
	declaration: ts.TypeAliasDeclaration,
	checker: ts.TypeChecker,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);
	if (
		containsKeyofTypeOperator(declaration.type) &&
		containsKeyofTypeOperatorOrAlias(declaration.type, checker, new Set(), includeExternalTypes)
	) {
		return true;
	}

	const typeNode = unwrapReadonlyContainerTypeNode(declaration.type);
	if (ts.isTypeReferenceNode(typeNode)) {
		const referencedDeclaration = getTypeAliasDeclaration(typeNode, checker);
		return referencedDeclaration
			? aliasNeedsSyntaxReplay(referencedDeclaration, checker, seen, includeExternalTypes)
			: false;
	}

	return (
		ts.isTypeOperatorNode(typeNode) ||
		ts.isArrayTypeNode(typeNode) ||
		ts.isTupleTypeNode(typeNode) ||
		ts.isUnionTypeNode(typeNode) ||
		ts.isIntersectionTypeNode(typeNode) ||
		ts.isConditionalTypeNode(typeNode) ||
		ts.isIndexedAccessTypeNode(typeNode)
	);
}

/** Returns the alias named by authored reference syntax, following import aliases. */
function getTypeAliasReferenceFromTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): AuthoredTypeAliasReference | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isImportTypeNode(unwrapped) && unwrapped.qualifier) {
		const symbol = checker.getSymbolAtLocation(unwrapped.qualifier);
		const targetSymbol =
			symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
		const declaration = targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
		return declaration ? { declaration, typeArgumentNodes: unwrapped.typeArguments } : undefined;
	}
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return undefined;
	}

	const declaration = getTypeAliasDeclaration(unwrapped, checker);
	return declaration ? { declaration, typeArgumentNodes: unwrapped.typeArguments } : undefined;
}

/** Returns TypeScript's retained alias identity when no authored reference is available. */
function getSemanticTypeAliasReference(type: ts.Type): AuthoredTypeAliasReference | undefined {
	const declaration = type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	return declaration ? { declaration, typeArguments: type.aliasTypeArguments } : undefined;
}

/**
 * Builds the active generic bindings for an authored alias. Missing arguments
 * use declaration defaults in order, so a later default such as `U = T` sees
 * the concrete binding already selected for `T`.
 */
function getTypeAliasParameterSubstitutions(
	reference: AuthoredTypeAliasReference,
	context: ScopedParserContext,
): AliasParameterSubstitutions | undefined {
	const typeParameters = reference.declaration.typeParameters;
	if (!typeParameters?.length) {
		return undefined;
	}

	const substitutions = new Map(context.typeParameterSubstitutions);
	const typeNodeSubstitutions = new Map(context.typeParameterTypeNodeSubstitutions);
	let addedSubstitution = false;
	let addedTypeNodeSubstitution = false;
	for (let index = 0; index < typeParameters.length; index += 1) {
		const parameter = typeParameters[index];
		const parameterType = context.checker.getTypeAtLocation(parameter);
		let argumentNode = reference.typeArgumentNodes?.[index];
		let argumentType = argumentNode
			? context.checker.getTypeFromTypeNode(argumentNode)
			: reference.typeArguments?.[index];
		if (!argumentType && parameter.default) {
			argumentNode = parameter.default;
			argumentType = context.checker.getTypeFromTypeNode(parameter.default);
		}
		if (!parameterType.symbol || !argumentType) {
			continue;
		}

		const substitutedArgument = substituteTypeParameter(argumentType, substitutions);
		const declarationSymbol = context.checker.getSymbolAtLocation(parameter.name);
		addAliasTypeParameterSymbols(
			reference.declaration.type,
			parameter,
			declarationSymbol ? [parameterType.symbol, declarationSymbol] : [parameterType.symbol],
			substitutedArgument,
			context.checker,
			substitutions,
			typeNodeSubstitutions,
			argumentNode,
		);
		addedSubstitution = true;
		addedTypeNodeSubstitution ||= Boolean(argumentNode);
	}

	return addedSubstitution
		? {
				types: substitutions,
				typeNodes: addedTypeNodeSubstitution ? typeNodeSubstitutions : undefined,
			}
		: undefined;
}

function addAliasTypeParameterSymbols(
	typeNode: ts.TypeNode,
	parameter: ts.TypeParameterDeclaration,
	parameterSymbols: readonly ts.Symbol[],
	argumentType: ts.Type,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type>,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode>,
	argumentNode: ts.TypeNode | undefined,
): void {
	for (const parameterSymbol of parameterSymbols) {
		substitutions.set(parameterSymbol, argumentType);
		if (argumentNode) {
			typeNodeSubstitutions.set(parameterSymbol, argumentNode);
		}
	}

	// Conditional types can expose a fresh checker-internal TypeParameter for an
	// authored `T`. Key the active substitution by that symbol as well, while
	// using symbol-at-location to avoid matching a nested shadowing parameter.
	const visit = (node: ts.Node): void => {
		const referencedSymbol = ts.isTypeReferenceNode(node)
			? checker.getSymbolAtLocation(node.typeName)
			: undefined;
		const referencesParameter =
			referencedSymbol &&
			(parameterSymbols.includes(referencedSymbol) ||
				referencedSymbol.declarations?.includes(parameter));
		if (ts.isTypeReferenceNode(node) && referencesParameter) {
			const referencedType = checker.getTypeFromTypeNode(node);
			if (referencedType.flags & ts.TypeFlags.TypeParameter && referencedType.symbol) {
				substitutions.set(referencedType.symbol, argumentType);
				if (argumentNode) {
					typeNodeSubstitutions.set(referencedType.symbol, argumentNode);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
}

/** Checks direct syntax and referenced aliases without expanding semantic types. */
export function typeAliasContainsKeyof(
	declaration: ts.TypeAliasDeclaration,
	checker: ts.TypeChecker,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);

	return containsKeyofTypeOperatorOrAlias(declaration.type, checker, seen, includeExternalTypes);
}

function getAuthoredAliasReference(
	{ type, typeNode }: TypeResolutionRequest,
	checker: ts.TypeChecker,
): AuthoredTypeAliasReference | undefined {
	const authoredReference = getTypeAliasReferenceFromTypeNode(typeNode, checker);
	if (authoredReference) {
		return authoredReference;
	}

	// A concrete body node must be resolved as written. Falling back to the
	// semantic alias here would re-enter the alias while replaying its own body.
	return typeNode ? undefined : getSemanticTypeAliasReference(type);
}

function getTypeAliasDeclaration(
	typeNode: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}

function getOuterAliasTypeName(
	{ type, typeName }: TypeResolutionRequest,
	referencedDeclaration: ts.TypeAliasDeclaration,
): TypeName | undefined {
	const semanticDeclaration = type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	if (!type.aliasSymbol || !semanticDeclaration || semanticDeclaration === referencedDeclaration) {
		return typeName;
	}

	const typeArgumentCount = semanticDeclaration.typeParameters?.length ?? 0;
	return new TypeName(
		type.aliasSymbol.name,
		typeName?.namespaces,
		typeArgumentCount > 0 ? typeName?.typeArguments?.slice(0, typeArgumentCount) : undefined,
	);
}
