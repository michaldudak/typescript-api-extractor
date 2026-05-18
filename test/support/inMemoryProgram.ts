import path from 'node:path';
import ts from 'typescript';

type InMemoryFiles = Record<string, string>;

export function createInMemoryProgram(
	filePath: string,
	sourceText: string,
	options?: ts.CompilerOptions,
): ts.Program;
export function createInMemoryProgram(
	files: InMemoryFiles,
	options?: ts.CompilerOptions,
): ts.Program;
export function createInMemoryProgram(
	filePathOrFiles: string | InMemoryFiles,
	sourceTextOrOptions?: string | ts.CompilerOptions,
	options: ts.CompilerOptions = {},
): ts.Program {
	const files =
		typeof filePathOrFiles === 'string'
			? { [filePathOrFiles]: sourceTextOrOptions as string }
			: filePathOrFiles;
	const rootNames = Object.keys(files);
	const compilerOptions: ts.CompilerOptions = {
		rootDir: path.dirname(rootNames[0]!),
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.Node16,
		moduleResolution: ts.ModuleResolutionKind.Node16,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		...(typeof sourceTextOrOptions === 'string' ? options : sourceTextOrOptions),
	};
	const host = ts.createCompilerHost(compilerOptions);
	const getSourceFile = host.getSourceFile.bind(host);

	host.getSourceFile = (sourceFileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const sourceText = files[sourceFileName];
		if (sourceText !== undefined) {
			return ts.createSourceFile(sourceFileName, sourceText, languageVersion, true);
		}

		return getSourceFile(sourceFileName, languageVersion, onError, shouldCreateNewSourceFile);
	};
	host.fileExists = (sourceFileName) =>
		files[sourceFileName] !== undefined || ts.sys.fileExists(sourceFileName);
	host.readFile = (sourceFileName) => files[sourceFileName] ?? ts.sys.readFile(sourceFileName);
	host.resolveModuleNames = (moduleNames, containingFile) =>
		moduleNames.map((moduleName) => resolveInMemoryModule(moduleName, containingFile, files));

	return ts.createProgram(rootNames, compilerOptions, host);
}

function resolveInMemoryModule(
	moduleName: string,
	containingFile: string,
	files: InMemoryFiles,
): ts.ResolvedModuleFull | undefined {
	for (const extension of supportedExtensions) {
		const candidate = path.resolve(path.dirname(containingFile), `${moduleName}${extension}`);
		if (files[candidate] !== undefined) {
			return {
				resolvedFileName: candidate,
				extension: extensionKinds[extension],
			};
		}
	}

	return undefined;
}

const supportedExtensions = ['.ts', '.tsx', '.d.ts'] as const;
const extensionKinds: Record<(typeof supportedExtensions)[number], ts.Extension> = {
	'.ts': ts.Extension.Ts,
	'.tsx': ts.Extension.Tsx,
	'.d.ts': ts.Extension.Dts,
};
