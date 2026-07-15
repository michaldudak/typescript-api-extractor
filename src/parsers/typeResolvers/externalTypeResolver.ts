import ts from 'typescript';
import { ExternalTypeNode, IntrinsicNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { isInternalSymbolName } from '../common';
import { isNodeModulesDeclaration } from '../sourceFileUtils';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';

const allowedBuiltInTsTypes = new Set([
	'Pick',
	'Omit',
	'ReturnType',
	'Parameters',
	'InstanceType',
	'Partial',
	'Required',
	'Readonly',
	'Exclude',
	'Extract',
]);

const allowedBuiltInReactTypes = new Set([
	'React.MemoExoticComponent',
	'React.NamedExoticComponent',
	'React.FC',
	'React.FunctionComponent',
	'React.ForwardRefExoticComponent',
]);

// External package types are summarized as references unless the
// caller opts into expanding them. Keeping this policy outside the structural
// resolvers prevents node_modules heuristics from leaking into object/function
// parsing.

/**
 * Summarizes a type defined in an external package as an opaque ExternalTypeNode
 * reference, preserving the authored name. Declines (returns undefined) when
 * `includeExternalTypes` is set or the type is local, so it is expanded normally.
 *
 * @param request - Semantic type, derived name, and optional authored alias syntax.
 * @param session - Active resolution session containing external-expansion policy.
 * @returns An opaque external reference, an unnamed `any` fallback, or `undefined` to decline.
 */
export function resolveExternalType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	const { checker, includeExternalTypes } = session.context;
	const authoredExternalAliasName = getExternalTypeAliasName(typeNode, checker);

	// Generic parameters inherit the declaration path of the alias that owns
	// them. For example, React's ComponentPropsWithRef expands through a `Props`
	// parameter declared in @types/react. The path makes that parameter look
	// external, but it is still generic syntax and must reach the type-parameter
	// resolver so callers see `Props` rather than an invented `React.Props` type.
	if (type.flags & ts.TypeFlags.TypeParameter) {
		return undefined;
	}

	// Array and tuple identity is a semantic checker fact and remains stable
	// across TypeScript versions and path separators. Let the dedicated
	// container resolvers handle built-in and local containers, but retain opaque
	// external aliases whose declarations merely happen to resolve to a container.
	const hasSemanticExternalAlias =
		type.aliasSymbol != null && isSymbolExternal(type.aliasSymbol, checker);
	if (
		(checker.isArrayType(type) || checker.isTupleType(type)) &&
		!authoredExternalAliasName &&
		!hasSemanticExternalAlias
	) {
		return undefined;
	}

	if (includeExternalTypes || (!isTypeExternal(type, checker) && !authoredExternalAliasName)) {
		return undefined;
	}

	// Determine the best name to use for this external type.
	// When a type fully resolves to an external interface (e.g., `Event` from lib.dom.d.ts),
	// TypeScript provides no aliasSymbol - the type is just the resolved interface.
	// In this case, use the resolved symbol's name (e.g., `Event`, `KeyboardEvent`).
	//
	// When a type is an external alias (e.g., `Point` from a package that wraps `{ x, y }`),
	// TypeScript preserves the aliasSymbol. Use the alias name to preserve the author's intent.
	const resolvedSymbol = type.getSymbol();
	const resolvedSymbolName = resolvedSymbol?.getName?.();

	let externalTypeName: string | undefined;
	const resolvedIsExternalInterface =
		resolvedSymbolName &&
		!isInternalSymbolName(resolvedSymbolName) &&
		isSymbolExternal(resolvedSymbol, checker, false) &&
		(resolvedSymbol?.flags ?? 0) & ts.SymbolFlags.Interface;

	if (resolvedIsExternalInterface && !type.aliasSymbol) {
		externalTypeName = resolvedSymbolName;
	} else {
		externalTypeName =
			authoredExternalAliasName ||
			typeName?.name ||
			type.aliasSymbol?.getName?.() ||
			resolvedSymbolName;
	}

	if (!externalTypeName) {
		return new IntrinsicNode('any');
	}

	// Fixes a weird TS behavior where it doesn't show the alias name but resolves to the actual type in case of RefCallback.
	if (externalTypeName === 'bivarianceHack') {
		return new ExternalTypeNode(new TypeName('RefCallback', ['React'], typeName?.typeArguments));
	}

	return new ExternalTypeNode(
		new TypeName(externalTypeName, typeName?.namespaces, typeName?.typeArguments),
	);
}

/**
 * Checks whether authored syntax belongs to an external type-alias declaration.
 *
 * @param typeNode - Authored syntax nested inside a possible type-alias declaration.
 * @param checker - Checker used to classify the alias symbol.
 * @returns Whether the surrounding alias is external under the resolver policy.
 */
export function isExternalTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): boolean {
	return getExternalTypeAliasName(typeNode, checker) !== undefined;
}

function getExternalTypeAliasName(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	let declaration = typeNode?.parent;
	while (declaration && !ts.isTypeAliasDeclaration(declaration)) {
		declaration = declaration.parent;
	}
	if (!declaration || !ts.isTypeAliasDeclaration(declaration)) {
		return undefined;
	}

	const symbol = checker.getSymbolAtLocation(declaration.name);
	return isSymbolExternal(symbol, checker) ? declaration.name.text : undefined;
}

function isTypeExternal(type: ts.Type, checker: ts.TypeChecker): boolean {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	return isSymbolExternal(symbol, checker);
}

/**
 * Checks if a symbol is defined externally (in node_modules), excluding allowed built-in types.
 */
function isSymbolExternal(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
	checkAllowList: boolean = true,
): boolean {
	if (!symbol) return false;
	return (
		symbol.declarations?.some((x) => {
			const sourceFileName = x.getSourceFile().fileName;
			const definedExternally = isNodeModulesDeclaration(x);
			if (!definedExternally) return false;
			if (!checkAllowList) return true;
			return !(
				(allowedBuiltInTsTypes.has(checker.getFullyQualifiedName(symbol)) &&
					/node_modules\/typescript\/lib/.test(sourceFileName)) ||
				(allowedBuiltInReactTypes.has(checker.getFullyQualifiedName(symbol)) &&
					/node_modules\/@types\/react/.test(sourceFileName))
			);
		}) ?? false
	);
}
