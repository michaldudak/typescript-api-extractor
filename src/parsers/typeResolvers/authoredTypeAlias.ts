import ts from 'typescript';
import { TypeName, withTypeName, type AnyType } from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import {
	containsKeyofTypeOperator,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

interface AuthoredTypeAliasReference {
	declaration: ts.TypeAliasDeclaration;
	typeArgumentNodes?: readonly ts.TypeNode[];
	typeArguments?: readonly ts.Type[];
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
		session.context.program.isSourceFileFromExternalLibrary(authoredSourceFile)
	) {
		return undefined;
	}
	if (
		!(semanticDeclaration && typeAliasContainsKeyofInSource(semanticDeclaration)) &&
		!typeNodeContainsKeyofAliasInSource(request.typeNode)
	) {
		return undefined;
	}
	if (!canCollapseAuthoredKeyofAlias(request.type, session.context.checker)) {
		return undefined;
	}

	const reference = getAuthoredAliasReference(request, session.context.checker);
	if (
		!reference ||
		!typeAliasContainsKeyof(reference.declaration, session.context.checker) ||
		!aliasNeedsSyntaxReplay(reference.declaration, session.context.checker)
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

	const substitutions = getTypeAliasParameterSubstitutions(reference, session.context);
	if (!hasConcreteTypeParameterBindings(reference.declaration, substitutions, session.context)) {
		return undefined;
	}
	const typeName = getOuterAliasTypeName(request, reference.declaration);
	const resolveAliasBody = () => {
		activeAliases.add(reference.declaration);
		try {
			const resolvedType = session.resolveWithSyntax({
				...request,
				typeName,
				typeNode: reference.declaration.type,
			});
			return resolvedType && typeName ? withTypeName(resolvedType, typeName) : resolvedType;
		} finally {
			activeAliases.delete(reference.declaration);
		}
	};

	return substitutions
		? session.context.runWithTypeParameterSubstitutionScope(substitutions, resolveAliasBody)
		: resolveAliasBody();
}

function hasConcreteTypeParameterBindings(
	declaration: ts.TypeAliasDeclaration,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	context: ScopedParserContext,
): boolean {
	if (!declaration.typeParameters?.length) {
		return true;
	}
	if (!substitutions) {
		return false;
	}

	return declaration.typeParameters.every((parameter) => {
		const parameterType = context.checker.getTypeAtLocation(parameter);
		const substitution = parameterType.symbol ? substitutions.get(parameterType.symbol) : undefined;
		return (
			substitution &&
			!(substituteTypeParameter(substitution, substitutions).flags & ts.TypeFlags.TypeParameter)
		);
	});
}

/**
 * Checks a root alias chain using source declarations only. This deliberately
 * avoids checker symbol queries so export normalization cannot perturb
 * TypeScript's lazy type caches before ordered type resolution begins.
 */
export function typeAliasContainsKeyofInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);
	if (containsKeyofTypeOperator(declaration.type)) {
		return true;
	}
	if (/[\\/]node_modules[\\/]/.test(declaration.getSourceFile().fileName)) {
		return false;
	}

	const referencedDeclaration = findLocalTypeAliasDeclaration(declaration.type);
	return referencedDeclaration
		? typeAliasContainsKeyofInSource(referencedDeclaration, seen)
		: false;
}

function typeNodeContainsKeyofAliasInSource(typeNode: ts.TypeNode | undefined): boolean {
	if (!typeNode) {
		return false;
	}
	if (containsKeyofTypeOperator(typeNode)) {
		return true;
	}

	const declaration = findLocalTypeAliasDeclaration(typeNode);
	return declaration ? typeAliasContainsKeyofInSource(declaration) : false;
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
		type.isUnion() ||
		type.isIntersection() ||
		(type.flags &
			(ts.TypeFlags.Conditional |
				ts.TypeFlags.Index |
				ts.TypeFlags.IndexedAccess |
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
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);

	const typeNode = unwrapReadonlyContainerTypeNode(declaration.type);
	if (ts.isTypeReferenceNode(typeNode)) {
		const referencedDeclaration = getTypeAliasDeclaration(typeNode, checker);
		return referencedDeclaration
			? aliasNeedsSyntaxReplay(referencedDeclaration, checker, seen)
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
): Map<ts.Symbol, ts.Type> | undefined {
	const typeParameters = reference.declaration.typeParameters;
	if (!typeParameters?.length) {
		return undefined;
	}

	const substitutions = new Map(context.typeParameterSubstitutions);
	let addedSubstitution = false;
	for (let index = 0; index < typeParameters.length; index += 1) {
		const parameter = typeParameters[index];
		const parameterType = context.checker.getTypeAtLocation(parameter);
		const argumentNode = reference.typeArgumentNodes?.[index];
		let argumentType = argumentNode
			? context.checker.getTypeFromTypeNode(argumentNode)
			: reference.typeArguments?.[index];
		if (!argumentType && parameter.default) {
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
		);
		addedSubstitution = true;
	}

	return addedSubstitution ? substitutions : undefined;
}

function addAliasTypeParameterSymbols(
	typeNode: ts.TypeNode,
	parameter: ts.TypeParameterDeclaration,
	parameterSymbols: readonly ts.Symbol[],
	argumentType: ts.Type,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type>,
): void {
	for (const parameterSymbol of parameterSymbols) {
		substitutions.set(parameterSymbol, argumentType);
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
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);

	if (containsKeyofTypeOperator(declaration.type)) {
		return true;
	}

	const typeNode = unwrapParenthesizedTypeNode(declaration.type);
	if (!ts.isTypeReferenceNode(typeNode)) {
		return false;
	}

	const referencedDeclaration = getTypeAliasDeclaration(typeNode, checker);
	return referencedDeclaration
		? typeAliasContainsKeyof(referencedDeclaration, checker, seen)
		: false;
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
