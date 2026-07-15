import ts from 'typescript';
import { ModuleNode, type AnyType } from './models';
import { parseModule } from './parsers/moduleParser';
import { createParserContext } from './parserContextFactory';

/**
 * Creates a TypeScript program and extracts the public API of one source file.
 * Use `createProgram` and `parseFromProgram` when extracting multiple files so
 * they can share the same checker and compiler caches.
 *
 * @param filePath - Source file to extract.
 * @param options - Compiler options returned by `loadConfig` or supplied directly.
 * @param parserOptions - Optional extraction policy and warning callbacks.
 * @returns The extracted module model for the requested file.
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
 * Extracts the public API of one source file from an existing TypeScript program.
 *
 * @param filePath - Source file already included in `program`.
 * @param program - Program whose checker owns the source file.
 * @param parserOptions - Optional extraction policy and warning callbacks.
 * @returns The extracted module model for the requested program source file.
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

	const parserContext = createParserContext(checker, sourceFile, program, parserOptions);

	return parseModule(sourceFile, parserContext);
}

/** Mutable parser state and resolved policy callbacks shared by nested resolvers. */
export interface ParserContext {
	/**
	 * Decides whether an object property should be included at the current depth.
	 *
	 * @param data - Property name and current resolution depth.
	 * @returns Whether the property should be included.
	 */
	shouldInclude: (data: { name: string; depth: number }) => boolean;
	/**
	 * Decides whether an object's properties should be expanded.
	 *
	 * @param data - Object name, property count, and current resolution depth.
	 * @returns Whether the object shape should be resolved.
	 */
	shouldResolveObject: (data: { name: string; propertyCount: number; depth: number }) => boolean;
	/** Whether declarations from external libraries may be expanded. */
	includeExternalTypes: boolean;
	/**
	 * Receives recoverable parser warnings.
	 *
	 * @param warning - Structured warning emitted by a recoverable fallback.
	 */
	onWarning: (warning: ParserWarning) => void;
	/** TypeScript checker used for all semantic queries. */
	checker: ts.TypeChecker;
	/** Root source file currently being extracted. */
	sourceFile: ts.SourceFile;
	/** Active internal type IDs used for recursion detection. */
	typeStack: number[];
	/** Compiler options of the owning program. */
	compilerOptions: ts.CompilerOptions;
	/** Active exported-symbol path included in warning metadata. */
	parsedSymbolStack: string[];
	/** Active authored nodes used to locate recoverable warnings. */
	sourceNodeStack: ts.Node[];
	/** Program that owns the checker and source file. */
	program: ts.Program;
	/** Active semantic substitutions for generic type parameters. */
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	/**
	 * Cache for resolved types to avoid resolving the same type multiple times.
	 * The key encodes both the type ID and the current stack depth, because
	 * depth-dependent options (`shouldResolveObject`, `shouldInclude`) can
	 * produce different results for the same type at different depths.
	 */
	resolvedTypeCache: Map<string, AnyType>;
}

/**
 * Options that specify how the parser should act
 */
export interface ParserOptions {
	/**
	 * Called before a property is added to an object type.
	 *
	 * @param data - Property name and current resolution depth.
	 * @returns `true` to include, `false` to omit, or `undefined` for the default policy.
	 */
	shouldInclude?: (data: { name: string; depth: number }) => boolean | undefined;
	/**
	 * Called before the shape of an object is resolved
	 *
	 * @param data - Object name, property count, and current resolution depth.
	 * @returns `true` to resolve the shape, `false` for an opaque object, or `undefined` for the default.
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
	 *
	 * @param warning - Structured warning describing the recovery.
	 */
	onWarning?: (warning: ParserWarning) => void;
}

/** Recoverable warning emitted while extracting an otherwise usable module model. */
export type ParserWarning =
	| UnsupportedTypeFallbackWarning
	| MissingEnumDeclarationWarning
	| MissingDefaultExportSymbolWarning;

/** Source location and symbol context shared by every recoverable parser warning. */
export interface ParserWarningBase {
	/** Human-readable warning text used by the default console reporter. */
	message: string;
	/** Source file associated with the recovery. */
	filePath: string;
	/** One-based source line. */
	line: number;
	/** One-based source column. */
	column: number;
	/** Export and nested member scopes active when the warning was emitted. */
	parsedSymbolStack: string[];
}

/** Warning emitted when an unsupported semantic type is represented by `any`. */
export interface UnsupportedTypeFallbackWarning extends ParserWarningBase {
	/** Stable warning discriminator. */
	code: 'unsupported-type-fallback';
	/** TypeScript flag names present on the unsupported checker type. */
	typeFlags: string[];
	/** Checker-rendered text for the unsupported type. */
	typeText: string;
	/** Authored syntax selected as the most precise diagnostic source, when available. */
	sourceText?: string;
}

/** Warning emitted when an enum-like type has no recoverable enum declaration. */
export interface MissingEnumDeclarationWarning extends ParserWarningBase {
	/** Stable warning discriminator. */
	code: 'missing-enum-declaration';
	/** Name of the enum-like type that could not be located. */
	enumName: string;
}

/** Warning emitted when TypeScript exposes a default export without a target symbol. */
export interface MissingDefaultExportSymbolWarning extends ParserWarningBase {
	/** Stable warning discriminator. */
	code: 'missing-default-export-symbol';
	/** Authored default-export text used to identify the failing declaration. */
	sourceText: string;
}
