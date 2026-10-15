import ts from 'typescript';
import { getAliasChainFlags, getDeclarationSpaces } from './declarationSpaces';

/**
 * Tracks what a walk has visited, so cyclic re-exports terminate.
 */
interface ValuePathVisits {
	aliases: Set<ts.Symbol>;
	containerExports: Map<ts.Symbol, Set<ts.__String>>;
}

/**
 * How an export of a module or namespace arrives: with its runtime value, as a
 * type only, or not at all. An export reached only through type-only star
 * exports is hidden when nothing but a value would remain (see
 * {@link isRetainedWithoutValue}).
 */
export type ContainerExportReach = 'value' | 'typeOnly' | 'hidden';

/**
 * Classifies one export of a module or namespace. See {@link ContainerExportReach}.
 *
 * @param containerSymbol The module or namespace symbol exporting the symbol.
 * @param exportSymbol The export symbol as the checker lists it for the container.
 * @param checker Type checker for resolving aliases and module specifiers.
 */
export function getContainerExportReach(
	containerSymbol: ts.Symbol,
	exportSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): ContainerExportReach {
	if (hasValueExportPath(containerSymbol, exportSymbol.escapedName, checker)) {
		return 'value';
	}

	const isStarExport = !containerSymbol.exports?.has(exportSymbol.escapedName);
	return isStarExport && !isRetainedWithoutValue(exportSymbol, checker) ? 'hidden' : 'typeOnly';
}

/**
 * Whether an export of a module or namespace reaches its target through at
 * least one path that crosses no type-only site (`export type { X }`,
 * `import type { X }`, `export type * from`). Only such a path carries the
 * runtime value. Star exports are followed module by module, because the
 * checker resolves them in one jump that hides type-only barrels.
 *
 * For example, with `export type * from './barrel'` and a barrel doing
 * `export * from './enums'`, an enum from `enums.ts` has no value path.
 *
 * @param containerSymbol The module or namespace symbol exporting the name.
 * @param exportName The escaped export name.
 * @param checker Type checker for resolving aliases and module specifiers.
 */
export function hasValueExportPath(
	containerSymbol: ts.Symbol,
	exportName: ts.__String,
	checker: ts.TypeChecker,
): boolean {
	return containerExportHasValuePath(containerSymbol, exportName, checker, createVisits());
}

/**
 * Whether an export symbol keeps its runtime value along its alias chain. A
 * symbol with its own value declarations, such as a local `const` merged with
 * an `import type`, keeps that value whatever the alias part says.
 *
 * @param symbol The export symbol, alias or not.
 * @param checker Type checker for resolving aliases and module specifiers.
 */
export function hasValueAliasPath(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	return aliasHasValuePath(symbol, checker, createVisits());
}

function createVisits(): ValuePathVisits {
	return { aliases: new Set(), containerExports: new Map() };
}

function containerExportHasValuePath(
	containerSymbol: ts.Symbol,
	exportName: ts.__String,
	checker: ts.TypeChecker,
	visits: ValuePathVisits,
): boolean {
	let visitedNames = visits.containerExports.get(containerSymbol);
	if (!visitedNames) {
		visitedNames = new Set();
		visits.containerExports.set(containerSymbol, visitedNames);
	}
	if (visitedNames.has(exportName)) {
		return false;
	}
	visitedNames.add(exportName);

	// Local exports shadow star exports of the same name.
	const localExport = containerSymbol.exports?.get(exportName);
	if (localExport) {
		return aliasHasValuePath(localExport, checker, visits);
	}

	// An `export =` module exports everything, its synthetic default included,
	// through that one assignment.
	const exportEquals = containerSymbol.exports?.get(ts.InternalSymbolName.ExportEquals);
	if (exportEquals) {
		return aliasHasValuePath(exportEquals, checker, visits);
	}

	return getStarExportDeclarations(containerSymbol).some((declaration) => {
		if (declaration.isTypeOnly || !declaration.moduleSpecifier) {
			return false;
		}

		const targetModule = checker.getSymbolAtLocation(declaration.moduleSpecifier);
		return (
			targetModule !== undefined &&
			checker.tryGetMemberInModuleExports(
				ts.unescapeLeadingUnderscores(exportName),
				targetModule,
			) !== undefined &&
			containerExportHasValuePath(targetModule, exportName, checker, visits)
		);
	});
}

function aliasHasValuePath(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	visits: ValuePathVisits,
): boolean {
	if (symbol.flags & ts.SymbolFlags.Value || !(symbol.flags & ts.SymbolFlags.Alias)) {
		return true;
	}
	if (visits.aliases.has(symbol)) {
		return false;
	}
	visits.aliases.add(symbol);

	const declarations = symbol.declarations ?? [];
	if (declarations.some(ts.isTypeOnlyImportOrExportDeclaration)) {
		return false;
	}

	const moduleHop = declarations.map(getModuleHop).find((hop) => hop !== undefined);
	if (moduleHop) {
		const targetModule = checker.getSymbolAtLocation(moduleHop.moduleSpecifier);
		return (
			targetModule === undefined ||
			containerExportHasValuePath(targetModule, moduleHop.exportName, checker, visits)
		);
	}

	const aliasedSymbol = checker.getImmediateAliasedSymbol(symbol);
	return aliasedSymbol === undefined || aliasHasValuePath(aliasedSymbol, checker, visits);
}

/**
 * The module and export name an import or re-export specifier reads from, so
 * the walk can continue through that module's own export paths.
 */
function getModuleHop(
	declaration: ts.Declaration,
): { moduleSpecifier: ts.Expression; exportName: ts.__String } | undefined {
	if (ts.isExportSpecifier(declaration)) {
		const moduleSpecifier = declaration.parent.parent.moduleSpecifier;
		return moduleSpecifier
			? { moduleSpecifier, exportName: getSpecifierExportName(declaration) }
			: undefined;
	}

	if (ts.isImportSpecifier(declaration)) {
		return {
			moduleSpecifier: declaration.parent.parent.parent.moduleSpecifier,
			exportName: getSpecifierExportName(declaration),
		};
	}

	if (ts.isImportClause(declaration)) {
		return {
			moduleSpecifier: declaration.parent.moduleSpecifier,
			exportName: ts.escapeLeadingUnderscores('default'),
		};
	}

	return undefined;
}

function getSpecifierExportName(specifier: ts.ImportOrExportSpecifier): ts.__String {
	return ts.escapeLeadingUnderscores((specifier.propertyName ?? specifier.name).text);
}

function getStarExportDeclarations(containerSymbol: ts.Symbol): ts.ExportDeclaration[] {
	return (containerSymbol.declarations ?? []).flatMap((declaration) => {
		const statements: readonly ts.Statement[] = ts.isSourceFile(declaration)
			? declaration.statements
			: ts.isModuleDeclaration(declaration) &&
				  declaration.body &&
				  ts.isModuleBlock(declaration.body)
				? declaration.body.statements
				: [];

		return statements.filter(
			(statement): statement is ts.ExportDeclaration =>
				ts.isExportDeclaration(statement) && !statement.exportClause,
		);
	});
}

/**
 * Whether an export reached only through type-only sites still has something to
 * export: a type meaning anywhere along its alias chain, or a namespace that is
 * not merged onto a function or variable. A function or variable is dropped
 * along with any namespace merged onto it, since only its value would remain.
 */
function isRetainedWithoutValue(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const declarationSpaces = getDeclarationSpaces(symbol, checker);
	return (
		declarationSpaces.isType ||
		(declarationSpaces.isNamespace &&
			(getAliasChainFlags(symbol, checker) &
				(ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) ===
				0)
	);
}
