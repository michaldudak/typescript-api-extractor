import type ts from 'typescript';
import { type ParserContext } from './parser';

/**
 * Internal parser context used by parser implementation modules. The public
 * `ParserContext` shape stays focused on observable parser state; scoped helper
 * methods live here so they do not become required for downstream callers that
 * reference the exported public type.
 */
export interface ScopedParserContext extends ParserContext {
	/**
	 * Runs parser work in a scoped diagnostic symbol context. The symbol is
	 * visible to warning/error metadata only while the callback runs, and the
	 * stack is restored even when parsing throws.
	 */
	runWithSymbolScope<T>(symbolName: string, callback: () => T): T;
	/**
	 * Runs parser work in a scoped diagnostic source-node context. Warning
	 * location fallback reads this stack, and undefined is accepted so callers
	 * do not need their own conditional push/pop boilerplate.
	 */
	runWithSourceNodeScope<T>(sourceNode: ts.Node | undefined, callback: () => T): T;
	/**
	 * Runs resolver work in a temporary type-parameter substitution scope for
	 * mapped/instantiated type expansion. The previous substitution map is
	 * always restored.
	 */
	runWithTypeParameterSubstitutionScope<T>(
		typeParameterSubstitutions: Map<ts.Symbol, ts.Type>,
		callback: () => T,
		typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	): T;
	/** Authored type arguments paired with the active semantic substitutions. */
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>;
}
