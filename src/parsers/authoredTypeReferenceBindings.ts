import ts from 'typescript';
import { declarationHasNodeModulesPathSegment } from './sourceFileUtils';
import { deriveTypeParameterBindings, type TypeParameterBindings } from './typeParameterBindings';
import { getReferencedTypeAliasDeclaration } from './typeResolvers/referencedTypeAlias';
import {
	containsKeyofTypeOperatorOrAlias,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeResolvers/typeOperatorTypeNodes';

/**
 * Derives semantic and authored bindings for a generic reference whose
 * arguments contain preservable `keyof` syntax. Alias parameters and the
 * parameters of the terminal interface or class are kept in one map so member
 * and signature resolvers see the same instantiated argument.
 *
 * @param typeNode - Authored generic reference to inspect.
 * @param checker - Checker used to follow aliases and bind declaration parameters.
 * @param includeExternalTypes - Whether bindings may traverse external declarations.
 * @param baseBindings - Active outer bindings to extend.
 * @returns Extended bindings, or `undefined` when the reference needs no source replay.
 */
export function getAuthoredTypeReferenceBindings(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	baseBindings?: TypeParameterBindings,
): TypeParameterBindings | undefined {
	if (!typeNode) {
		return undefined;
	}

	const reference = unwrapParenthesizedTypeNode(typeNode);
	const typeArguments = getReferenceTypeArguments(reference);
	if (
		!typeArguments?.some((argument) =>
			containsKeyofTypeOperatorOrAlias(
				argument,
				checker,
				new Set(),
				includeExternalTypes,
				baseBindings?.typeNodes,
			),
		)
	) {
		return undefined;
	}

	return followAuthoredTypeReferenceBindings(
		reference,
		checker,
		includeExternalTypes,
		baseBindings,
		new Set(),
	);
}

function followAuthoredTypeReferenceBindings(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
): TypeParameterBindings | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, baseBindings?.typeNodes);
	const declaration = getReferencedTypeAliasDeclaration(substituted, checker);
	if (declaration) {
		if (
			seenAliases.has(declaration) ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
		) {
			return baseBindings;
		}

		const bindings =
			deriveTypeParameterBindings({
				checker,
				declarations: declaration.typeParameters,
				authoredArguments: getReferenceTypeArguments(substituted),
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: declaration.type,
			}) ?? baseBindings;
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(declaration);
		return followAuthoredTypeReferenceBindings(
			declaration.type,
			checker,
			includeExternalTypes,
			bindings,
			nextSeenAliases,
		);
	}

	const genericDeclaration = getReferencedGenericDeclaration(substituted, checker);
	if (
		!genericDeclaration?.typeParameters?.length ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(genericDeclaration))
	) {
		return baseBindings;
	}

	return (
		deriveTypeParameterBindings({
			checker,
			declarations: genericDeclaration.typeParameters,
			authoredArguments: getReferenceTypeArguments(substituted),
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: genericDeclaration,
		}) ?? baseBindings
	);
}

function getReferenceTypeArguments(typeNode: ts.TypeNode): readonly ts.TypeNode[] | undefined {
	return ts.isTypeReferenceNode(typeNode) || ts.isImportTypeNode(typeNode)
		? typeNode.typeArguments
		: undefined;
}

function getReferencedGenericDeclaration(
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
