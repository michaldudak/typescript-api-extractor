import ts from 'typescript';

const nodeModulesPathPattern = /(?:^|[\\/])node_modules(?:[\\/]|$)/;

/** Classifies physical node_modules paths without matching similarly named directories. */
export function isNodeModulesSourceFile(sourceFile: ts.SourceFile): boolean {
	return nodeModulesPathPattern.test(sourceFile.fileName);
}

export function isNodeModulesDeclaration(declaration: ts.Declaration): boolean {
	return isNodeModulesSourceFile(declaration.getSourceFile());
}
