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
	resolve(request: TypeResolutionRequest, session: TypeResolutionSession): AnyType | undefined;
}
