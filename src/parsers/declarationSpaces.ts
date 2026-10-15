import ts from 'typescript';
import { type DeclarationSpaces } from '../models';

/**
 * Determines which declaration spaces an export occupies. See
 * {@link DeclarationSpaces} for the semantics.
 *
 * Every symbol on the alias chain contributes its own flags: an alias merged
 * with a local declaration occupies the spaces of both, and each hop of a
 * re-export chain can merge in more. Namespaces are recognized by an actual
 * namespace, module, or source-file declaration rather than
 * `SymbolFlags.Module`, because the binder also sets that flag for expando
 * assignments (`fn.extra = ...`).
 */
export function getDeclarationSpaces(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
): DeclarationSpaces {
	const chain = getAliasChain(symbol, checker);
	const flags = getCombinedFlags(chain);

	return {
		isValue: (flags & ts.SymbolFlags.Value) !== 0,
		isType: (flags & ts.SymbolFlags.Type) !== 0,
		isNamespace: chain.some(
			(current) =>
				current.declarations?.some(
					(declaration) => ts.isModuleDeclaration(declaration) || ts.isSourceFile(declaration),
				) ?? false,
		),
	};
}

/**
 * The symbol flags of every symbol on the alias chain, combined. See
 * {@link getDeclarationSpaces}.
 */
export function getAliasChainFlags(symbol: ts.Symbol, checker: ts.TypeChecker): ts.SymbolFlags {
	return getCombinedFlags(getAliasChain(symbol, checker));
}

function getAliasChain(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
	const chain: ts.Symbol[] = [];
	let current: ts.Symbol | undefined = symbol;
	while (current && !chain.includes(current)) {
		chain.push(current);
		current =
			current.flags & ts.SymbolFlags.Alias ? checker.getImmediateAliasedSymbol(current) : undefined;
	}

	return chain;
}

function getCombinedFlags(chain: ts.Symbol[]): ts.SymbolFlags {
	return chain.reduce<ts.SymbolFlags>(
		(flags, current) => flags | current.flags,
		ts.SymbolFlags.None,
	);
}
