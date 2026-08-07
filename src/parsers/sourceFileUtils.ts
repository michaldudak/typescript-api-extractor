import ts from 'typescript';

const nodeModulesPathSubstring = 'node_modules';
const nodeModulesPathSegmentPattern = /[\\/]node_modules[\\/]/;

/**
 * Applies the historical broad external-type heuristic to a source file.
 *
 * This intentionally treats any path containing `node_modules` as external,
 * including similarly named directories. The external and object resolvers
 * exposed that behavior before the shared helper existed, so changing it would
 * alter public extraction output.
 *
 * @param sourceFile - Source file whose path should be classified.
 * @returns Whether the file name contains the `node_modules` substring.
 */
export function isNodeModulesSourceFile(sourceFile: ts.SourceFile): boolean {
	return sourceFile.fileName.includes(nodeModulesPathSubstring);
}

/**
 * Applies the broad external-type heuristic to a declaration's source file.
 *
 * @param declaration - Declaration whose owning source file should be classified.
 * @returns Whether the declaration belongs to a broadly external path.
 */
export function isNodeModulesDeclaration(declaration: ts.Declaration): boolean {
	return isNodeModulesSourceFile(declaration.getSourceFile());
}

/**
 * Checks whether a path contains an actual `node_modules` directory segment.
 *
 * Authored-syntax replay historically used this narrower policy. Keeping it
 * separate from `isNodeModulesSourceFile` prevents directories such as
 * `my_node_modules` from being mistaken for third-party syntax sources.
 *
 * @param sourceFile - Source file whose normalized path segments should be checked.
 * @returns Whether an exact `node_modules` segment occurs in the file name.
 */
export function hasNodeModulesPathSegment(sourceFile: ts.SourceFile): boolean {
	return nodeModulesPathSegmentPattern.test(sourceFile.fileName);
}

/**
 * Checks a declaration's source path for an exact `node_modules` segment.
 *
 * @param declaration - Declaration whose owning source path should be checked.
 * @returns Whether the declaration is inside an actual `node_modules` segment.
 */
export function declarationHasNodeModulesPathSegment(declaration: ts.Declaration): boolean {
	return hasNodeModulesPathSegment(declaration.getSourceFile());
}
