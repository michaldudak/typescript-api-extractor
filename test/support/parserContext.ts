import ts from 'typescript';
import { type AnyType } from '../../src/models';
import { type ParserWarning } from '../../src/parser';
import { type ScopedParserContext } from '../../src/parserContext';

export interface TestParserContext {
	context: ScopedParserContext;
	warnings: ParserWarning[];
}

/**
 * Builds a real ScopedParserContext from a program, mirroring the production
 * factory in parser.ts but capturing warnings into an array instead of routing
 * them to console. Used to exercise resolveType / TypeResolutionSession directly.
 */
export function createTestParserContext(program: ts.Program, filePath: string): TestParserContext {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Program doesn't contain file: "${filePath}"`);
	}

	const warnings: ParserWarning[] = [];
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
		resolvedTypeCache: new Map<string, AnyType>(),
		shouldInclude: () => true,
		shouldResolveObject: () => true,
		includeExternalTypes: false,
		onWarning: (warning) => {
			warnings.push(warning);
		},
		runWithSymbolScope: (symbolName, callback) =>
			runWithStackEntryScope(parsedSymbolStack, symbolName, callback),
		runWithSourceNodeScope: (sourceNode, callback) => {
			if (!sourceNode) {
				return callback();
			}

			return runWithStackEntryScope(sourceNodeStack, sourceNode, callback);
		},
		runWithTypeParameterSubstitutionScope: (
			typeParameterSubstitutions,
			callback,
			typeParameterTypeNodeSubstitutions,
		) => {
			const previousTypeParameterSubstitutions = context.typeParameterSubstitutions;
			const previousTypeParameterTypeNodeSubstitutions = context.typeParameterTypeNodeSubstitutions;
			context.typeParameterSubstitutions = typeParameterSubstitutions;
			if (typeParameterTypeNodeSubstitutions) {
				context.typeParameterTypeNodeSubstitutions = typeParameterTypeNodeSubstitutions;
			}

			try {
				return callback();
			} finally {
				if (previousTypeParameterSubstitutions) {
					context.typeParameterSubstitutions = previousTypeParameterSubstitutions;
				} else {
					delete context.typeParameterSubstitutions;
				}
				if (previousTypeParameterTypeNodeSubstitutions) {
					context.typeParameterTypeNodeSubstitutions = previousTypeParameterTypeNodeSubstitutions;
				} else {
					delete context.typeParameterTypeNodeSubstitutions;
				}
			}
		},
	};

	return { context, warnings };
}

function runWithStackEntryScope<T, TEntry>(stack: TEntry[], entry: TEntry, callback: () => T): T {
	stack.push(entry);

	try {
		return callback();
	} finally {
		stack.pop();
	}
}
