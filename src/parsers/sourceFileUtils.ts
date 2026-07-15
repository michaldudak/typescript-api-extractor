import ts from 'typescript';

const nodeModulesPathSubstring = 'node_modules';
const nodeModulesPathSegmentPattern = /[\\/]node_modules[\\/]/;

/** Preserves the parser's historical substring-based external-source policy. */
export function isNodeModulesSourceFile(sourceFile: ts.SourceFile): boolean {
	return sourceFile.fileName.includes(nodeModulesPathSubstring);
}

export function isNodeModulesDeclaration(declaration: ts.Declaration): boolean {
	return isNodeModulesSourceFile(declaration.getSourceFile());
}

/** Matches authored-syntax paths that contain an actual node_modules segment. */
export function hasNodeModulesPathSegment(sourceFile: ts.SourceFile): boolean {
	return nodeModulesPathSegmentPattern.test(sourceFile.fileName);
}

export function declarationHasNodeModulesPathSegment(declaration: ts.Declaration): boolean {
	return hasNodeModulesPathSegment(declaration.getSourceFile());
}
