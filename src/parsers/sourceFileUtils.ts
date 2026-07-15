import ts from 'typescript';

const nodeModulesPathSubstring = 'node_modules';

/** Preserves the parser's historical substring-based external-source policy. */
export function isNodeModulesSourceFile(sourceFile: ts.SourceFile): boolean {
	return sourceFile.fileName.includes(nodeModulesPathSubstring);
}

export function isNodeModulesDeclaration(declaration: ts.Declaration): boolean {
	return isNodeModulesSourceFile(declaration.getSourceFile());
}
