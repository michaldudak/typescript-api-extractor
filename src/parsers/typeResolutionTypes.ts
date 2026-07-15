import ts from 'typescript';
import { type AnyType } from '../models';
import { type TypeName } from '../models/typeName';
import { type ScopedParserContext } from '../parserContext';

// Boundary note: resolver modules choose how a ts.Type enters the model and
// own pipeline precedence, warning replay, session-aware recursion, and model
// construction for their type class. Shared helpers stay small and serve
// substructures like signature type parameters rather than top-level type shapes.
export type ResolveTypeInContext = (
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ScopedParserContext,
) => AnyType;

export type NameResolutionWarning = Parameters<ScopedParserContext['onWarning']>[0];

export interface TypeResolutionRequest {
	type: ts.Type;
	typeNode: ts.TypeNode | undefined;
	typeName: TypeName | undefined;
}

/**
 * Session contract shared by resolver modules. Keeping this as an interface
 * lets individual resolver groups recurse without importing the concrete
 * orchestration class, which avoids turning the split modules into a cycle.
 */
export interface TypeResolutionSession {
	readonly context: ScopedParserContext;
	readonly resolveWithContext: ResolveTypeInContext;
	resolve(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType;
	/** Re-dispatches an active type against recovered syntax without pushing a second cycle frame. */
	resolveWithSyntax(request: TypeResolutionRequest): AnyType | undefined;
	/** Tries the syntax-replay resolvers before entering the normal cached resolution path. */
	resolveAuthoredSyntax(request: TypeResolutionRequest): AnyType;
	/** Returns whether this semantic type already has an active cycle frame. */
	isTypeActive(type: ts.Type): boolean;
	/** Runs a nested resolution inside a balanced cycle frame when the type has an id. */
	runWithTypeFrame<T>(type: ts.Type, callback: () => T): T;
}

export interface TypeResolver {
	/**
	 * Human-readable resolver identity. This is intentionally kept in the source
	 * so the pipeline can be debugged or profiled without guessing which branch
	 * handled a type.
	 */
	name: string;
	/**
	 * Most resolvers keep the TypeName computed before dispatching and should
	 * replay any warnings produced while deriving that name. A resolver can opt
	 * out when it intentionally discards the computed name, such as conditional
	 * and index-like fallbacks that resolve to a different underlying type.
	 */
	replayNameResolutionWarnings?: boolean;
	/** Resolver participates in authored syntax replay before semantic fallback. */
	replaysAuthoredSyntax?: boolean;
	/**
	 * Attempts to resolve the request's `ts.Type` into a model node. Returns
	 * `undefined` to decline, which lets the pipeline fall through to the next
	 * resolver; this is how precedence between overlapping TypeScript shapes works.
	 */
	resolve(request: TypeResolutionRequest, session: TypeResolutionSession): AnyType | undefined;
}
