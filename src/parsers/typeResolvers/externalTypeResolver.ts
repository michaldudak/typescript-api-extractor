import ts from 'typescript';
import { ExternalTypeNode, IntrinsicNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { isInternalSymbolName } from '../common';
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

export function resolveExternalType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker, includeExternalTypes } = session.context;

	if (includeExternalTypes || !isTypeExternal(type, checker)) {
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
		externalTypeName = typeName?.name || type.aliasSymbol?.getName?.() || resolvedSymbolName;
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
			const definedExternally = sourceFileName.includes('node_modules');
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
