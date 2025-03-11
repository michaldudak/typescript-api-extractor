import path from 'node:path';
import ts from 'typescript';
import * as t from './types';
import { augmentComponentNodes } from './parsers/componentParser';
import { parseExport } from './parsers/exportParser';

/**
 * A wrapper for `ts.createProgram`
 * @param files The files to later be parsed with `parseFromProgram`
 * @param options The options to pass to the compiler
 */
export function createProgram(files: string[], options: ts.CompilerOptions) {
	return ts.createProgram(files, options);
}

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
	parserOptions: Partial<ParserOptions> = {},
): t.ModuleNode {
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
	parserOptions: Partial<ParserOptions> = {},
): t.ModuleNode {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath);

	if (!sourceFile) {
		throw new Error(`Program doesn't contain file: "${filePath}"`);
	}

	const parserContext: ParserContext = {
		checker,
		sourceFile,
		typeStack: [],
		...getParserOptions(parserOptions),
	};

	const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!sourceFileSymbol) {
		throw new Error('Failed to get the source file symbol');
	}

	let parsedModuleExports: t.ExportNode[] = [];
	const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

	for (const exportedSymbol of exportedSymbols) {
		const parsedExport = parseExport(exportedSymbol, parserContext);
		if (!parsedExport) {
			continue;
		}

		parsedModuleExports.push(parsedExport);
	}

	parsedModuleExports = augmentComponentNodes(parsedModuleExports, parserContext);

	const relativeModulePath = path.relative(
		program.getCompilerOptions().rootDir!,
		JSON.parse(sourceFileSymbol.name),
	);

	return t.moduleNode(relativeModulePath, parsedModuleExports);
}

function getParserOptions(parserOptions: Partial<ParserOptions>): ParserOptions {
	const shouldInclude: ParserOptions['shouldInclude'] = (data) => {
		if (parserOptions.shouldInclude) {
			const result = parserOptions.shouldInclude(data);
			if (result !== undefined) {
				return result;
			}
		}

		return true;
	};

	const shouldResolveObject: ParserOptions['shouldResolveObject'] = (data) => {
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
	};
}

export interface ParserContext extends ParserOptions {
	checker: ts.TypeChecker;
	sourceFile: ts.SourceFile;
	typeStack: number[];
}

/**
 * Options that specify how the parser should act
 */
export interface ParserOptions {
	/**
	 * Called before a property is added to an object type.
	 */
	shouldInclude: (data: { name: string; depth: number }) => boolean | undefined;
	/**
	 * Called before the shape of an object is resolved
	 * @return true to resolve the shape of the object, false to just use a object, or undefined to
	 * use the default behaviour
	 * @default propertyCount <= 50 && depth <= 10
	 */
	shouldResolveObject: (data: {
		name: string;
		propertyCount: number;
		depth: number;
	}) => boolean | undefined;
	/**
	 * Control if external types and members should be included in the output.
	 * @default false
	 */
	includeExternalTypes?: boolean;
}
