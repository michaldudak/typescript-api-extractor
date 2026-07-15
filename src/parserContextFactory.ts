import ts from 'typescript';
import { type ParserOptions } from './parser';
import { type ScopedParserContext } from './parserContext';

/** Builds the internal scoped context shared by production parsing and focused tests. */
export function createParserContext(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	program: ts.Program,
	parserOptions: ParserOptions = {},
): ScopedParserContext {
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];
	const context: ScopedParserContext = {
		checker,
		sourceFile,
		typeStack: [],
		compilerOptions: program.getCompilerOptions(),
		parsedSymbolStack,
		sourceNodeStack,
		program,
		resolvedTypeCache: new Map(),
		...resolveParserOptions(parserOptions),
		runWithSymbolScope: (symbolName, callback) =>
			runWithStackEntryScope(parsedSymbolStack, symbolName, callback),
		runWithSourceNodeScope: (sourceNode, callback) =>
			sourceNode ? runWithStackEntryScope(sourceNodeStack, sourceNode, callback) : callback(),
		runWithTypeParameterSubstitutionScope: (
			typeParameterSubstitutions,
			callback,
			typeParameterTypeNodeSubstitutions,
		) => {
			const previousTypes = context.typeParameterSubstitutions;
			const previousTypeNodes = context.typeParameterTypeNodeSubstitutions;
			context.typeParameterSubstitutions = typeParameterSubstitutions;
			if (typeParameterTypeNodeSubstitutions) {
				context.typeParameterTypeNodeSubstitutions = typeParameterTypeNodeSubstitutions;
			}

			try {
				return callback();
			} finally {
				restoreOptionalProperty(context, 'typeParameterSubstitutions', previousTypes);
				restoreOptionalProperty(context, 'typeParameterTypeNodeSubstitutions', previousTypeNodes);
			}
		},
	};

	return context;
}

function resolveParserOptions(parserOptions: ParserOptions) {
	return {
		shouldInclude: (data: { name: string; depth: number }) =>
			parserOptions.shouldInclude?.(data) ?? true,
		shouldResolveObject: (data: { name: string; propertyCount: number; depth: number }) =>
			parserOptions.shouldResolveObject?.(data) ?? (data.propertyCount <= 50 && data.depth <= 10),
		includeExternalTypes: parserOptions.includeExternalTypes ?? false,
		onWarning:
			parserOptions.onWarning ??
			((warning) => {
				console.warn(warning.message);
			}),
	};
}

function runWithStackEntryScope<T, TEntry>(stack: TEntry[], entry: TEntry, callback: () => T): T {
	stack.push(entry);
	try {
		return callback();
	} finally {
		stack.pop();
	}
}

function restoreOptionalProperty<
	TKey extends 'typeParameterSubstitutions' | 'typeParameterTypeNodeSubstitutions',
>(context: ScopedParserContext, key: TKey, value: ScopedParserContext[TKey]): void {
	if (value) {
		context[key] = value;
	} else {
		delete context[key];
	}
}
