import ts from 'typescript';
import { ModuleNode, type AnyType } from './models';
import { parseModule } from './parsers/moduleParser';

/**
 * Creates a program, parses the specified file and returns the PropTypes as an AST, if you need to parse more than one file
 * use `createProgram` and `parseFromProgram` for better performance
 * @param filePath The file to parse
 * @param options The options from `loadConfig`
 * @param parserOptions Options that specify how the parser should act
 */
export function parseFile(
	filePath: string,
	options: ts.CompilerOptions,
	parserOptions?: ParserOptions,
): ModuleNode {
	const program = ts.createProgram([filePath], options);
	return parseFromProgram(filePath, program, parserOptions);
}

/**
 * Parses the specified file and returns the PropTypes as an AST
 * @param filePath The file to get the PropTypes from
 * @param program The program object returned by `createProgram`
 * @param parserOptions Options that specify how the parser should act
 */
export function parseFromProgram(
	filePath: string,
	program: ts.Program,
	parserOptions?: ParserOptions,
): ModuleNode {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath);

	if (!sourceFile) {
		throw new Error(`Program doesn't contain file: "${filePath}"`);
	}

	const parserContext = createParserContext(checker, sourceFile, program, parserOptions ?? {});

	return parseModule(sourceFile, parserContext);
}

function createParserContext(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	program: ts.Program,
	parserOptions: ParserOptions,
): ParserContext {
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];

	const context: ParserContext = {
		checker,
		sourceFile,
		typeStack: [],
		compilerOptions: program.getCompilerOptions(),
		parsedSymbolStack,
		sourceNodeStack,
		program,
		resolvedTypeCache: new Map<string, AnyType>(),
		...getParserOptions(parserOptions),
		runWithSymbolScope: (symbolName, callback) =>
			runWithStackEntryScope(parsedSymbolStack, symbolName, callback),
		runWithSourceNodeScope: (sourceNode, callback) => {
			if (!sourceNode) {
				return callback();
			}

			return runWithStackEntryScope(sourceNodeStack, sourceNode, callback);
		},
		runWithTypeParameterSubstitutionScope: (typeParameterSubstitutions, callback) => {
			const previousTypeParameterSubstitutions = context.typeParameterSubstitutions;
			context.typeParameterSubstitutions = typeParameterSubstitutions;

			try {
				return callback();
			} finally {
				if (previousTypeParameterSubstitutions) {
					context.typeParameterSubstitutions = previousTypeParameterSubstitutions;
				} else {
					delete context.typeParameterSubstitutions;
				}
			}
		},
	};

	return context;
}

function runWithStackEntryScope<T, TEntry>(stack: TEntry[], entry: TEntry, callback: () => T): T {
	stack.push(entry);

	try {
		return callback();
	} finally {
		stack.pop();
	}
}

function getParserOptions(parserOptions: ParserOptions): ResolvedParserOptions {
	const shouldInclude: ResolvedParserOptions['shouldInclude'] = (data) => {
		if (parserOptions.shouldInclude) {
			const result = parserOptions.shouldInclude(data);
			if (result !== undefined) {
				return result;
			}
		}

		return true;
	};

	const shouldResolveObject: ResolvedParserOptions['shouldResolveObject'] = (data) => {
		if (parserOptions.shouldResolveObject) {
			const result = parserOptions.shouldResolveObject(data);
			if (result !== undefined) {
				return result;
			}
		}

		return data.propertyCount <= 50 && data.depth <= 10;
	};

	return {
		shouldInclude,
		shouldResolveObject,
		includeExternalTypes: parserOptions.includeExternalTypes ?? false,
		onWarning:
			parserOptions.onWarning ??
			((warning) => {
				console.warn(warning.message);
			}),
	};
}

interface ResolvedParserOptions {
	shouldInclude: (data: { name: string; depth: number }) => boolean;
	shouldResolveObject: (data: { name: string; propertyCount: number; depth: number }) => boolean;
	includeExternalTypes: boolean;
	onWarning: (warning: ParserWarning) => void;
}

export interface ParserContext extends ResolvedParserOptions {
	checker: ts.TypeChecker;
	sourceFile: ts.SourceFile;
	typeStack: number[];
	compilerOptions: ts.CompilerOptions;
	parsedSymbolStack: string[];
	sourceNodeStack: ts.Node[];
	program: ts.Program;
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	/**
	 * Cache for resolved types to avoid resolving the same type multiple times.
	 * The key encodes both the type ID and the current stack depth, because
	 * depth-dependent options (`shouldResolveObject`, `shouldInclude`) can
	 * produce different results for the same type at different depths.
	 */
	resolvedTypeCache: Map<string, AnyType>;
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
	): T;
}

/**
 * Options that specify how the parser should act
 */
export interface ParserOptions {
	/**
	 * Called before a property is added to an object type.
	 */
	shouldInclude?: (data: { name: string; depth: number }) => boolean | undefined;
	/**
	 * Called before the shape of an object is resolved
	 * @return true to resolve the shape of the object, false to just use a object, or undefined to
	 * use the default behaviour
	 * @default propertyCount <= 50 && depth <= 10
	 */
	shouldResolveObject?: (data: {
		name: string;
		propertyCount: number;
		depth: number;
	}) => boolean | undefined;
	/**
	 * Control if external types and members should be included in the output.
	 * @default false
	 */
	includeExternalTypes?: boolean;
	/**
	 * Called when the parser recovers from a non-fatal issue.
	 * If not provided, warnings are printed with console.warn.
	 */
	onWarning?: (warning: ParserWarning) => void;
}

export type ParserWarning = UnsupportedTypeFallbackWarning | MissingEnumDeclarationWarning;

export interface ParserWarningBase {
	message: string;
	filePath: string;
	line: number;
	column: number;
	parsedSymbolStack: string[];
}

export interface UnsupportedTypeFallbackWarning extends ParserWarningBase {
	code: 'unsupported-type-fallback';
	typeFlags: string[];
	typeText: string;
	sourceText?: string;
}

export interface MissingEnumDeclarationWarning extends ParserWarningBase {
	code: 'missing-enum-declaration';
	enumName: string;
}
