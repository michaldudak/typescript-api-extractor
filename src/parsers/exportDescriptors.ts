import ts from 'typescript';
import { ParserContext } from '../parser';
import { ParserError } from '../ParserError';
import { type ExtendsTypeInfo } from '../models';
import { isInternalSymbolName } from './common';

/**
 * Normalized description of one exported API surface before it is converted to
 * an `ExportNode`. Keeping this shape separate from model construction lets
 * export-target resolution, namespace merging, re-export metadata, and warning
 * emission stay testable without also running the full type resolver.
 */
export interface ExportDescriptor {
	/** Public export name for this descriptor, without parent namespace prefixes. */
	name: string;
	/** Target symbol used for documentation and final type resolution. */
	symbol: ts.Symbol;
	/** Type acquired during normalization so declaration dispatch stays in this module. */
	type: ts.Type;
	/** Public namespace path applied when this descriptor came from a namespace export. */
	parentNamespaces: string[];
	/** Symbol scopes replayed while converting the descriptor into warning-aware output nodes. */
	symbolScope: string[];
	/** Authored type node, when it affects alias or union preservation during type resolution. */
	typeNode?: ts.TypeNode;
	reexportedFrom?: string;
	extendsTypes?: ExtendsTypeInfo[];
}

/**
 * Normalizes one TypeScript export symbol into descriptor records.
 *
 * Example: `export namespace Dialog { export type Props = ... }` returns
 * descriptors for the namespace members rather than an output node for the
 * namespace declaration itself.
 */
export function resolveExportDescriptors(
	exportSymbol: ts.Symbol,
	context: ParserContext,
	parentNamespaces: string[] = [],
	parentSymbolScope: string[] = [],
): ExportDescriptor[] | undefined {
	return context.runWithSymbolScope(exportSymbol.name, () => {
		try {
			const symbolScope = [...parentSymbolScope, exportSymbol.name];
			const declarations = exportSymbol.declarations;
			if (!declarations || declarations.length === 0) {
				return;
			}

			const exportDeclaration = declarations[0];
			const namespaceDescriptors = resolveMergedNamespaceDescriptors(
				exportSymbol,
				exportSymbol.name,
				context,
				parentNamespaces,
				symbolScope,
			);

			if (ts.isModuleDeclaration(exportDeclaration)) {
				return asNonEmptyDescriptors(namespaceDescriptors);
			}

			if (ts.isNamespaceExport(exportDeclaration)) {
				return resolveNamespaceExportDescriptors(
					exportSymbol,
					context,
					parentNamespaces,
					symbolScope,
				);
			}

			if (ts.isExportSpecifier(exportDeclaration)) {
				return resolveExportSpecifierDescriptors(
					exportSymbol,
					exportDeclaration,
					context,
					parentNamespaces,
					symbolScope,
					namespaceDescriptors,
				);
			}

			const mainDescriptor = resolveDeclarationExportDescriptor(
				exportSymbol,
				exportDeclaration,
				context,
				parentNamespaces,
				symbolScope,
			);

			return withNamespaceDescriptors(mainDescriptor, namespaceDescriptors);
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Handles `export * as Name from './module'` namespace re-exports.
 *
 * Example: `export * as Component from './parts'` gives every member from
 * `./parts` the parent namespace `Component`.
 */
function resolveNamespaceExportDescriptors(
	exportSymbol: ts.Symbol,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor[] | undefined {
	const aliasedSymbol = context.checker.getAliasedSymbol(exportSymbol);
	if (!aliasedSymbol) {
		return;
	}

	return asNonEmptyDescriptors(
		resolveNamespaceMemberDescriptors(
			aliasedSymbol,
			exportSymbol.name,
			context,
			parentNamespaces,
			symbolScope,
		),
	);
}

/**
 * Handles named export specifiers, including aliases and re-exports.
 *
 * Example: `export { ComponentRoot as Root } from './root'` targets the
 * `ComponentRoot` symbol, records `reexportedFrom: 'ComponentRoot'`, and keeps
 * the public descriptor name `Root`.
 */
function resolveExportSpecifierDescriptors(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
	namespaceDescriptors: ExportDescriptor[],
): ExportDescriptor[] | undefined {
	const targetSymbol = resolveExportSpecifierTarget(exportSymbol, exportDeclaration, context);
	if (!targetSymbol) {
		return withNamespaceDescriptors(undefined, namespaceDescriptors);
	}

	const targetNamespaceDescriptors = resolveMergedNamespaceDescriptors(
		targetSymbol,
		exportSymbol.name,
		context,
		parentNamespaces,
		symbolScope,
	);
	const type = getExportSpecifierType(targetSymbol, exportDeclaration, context);
	const isReExport = isModuleReExportSpecifier(exportDeclaration);
	const reexportedFrom =
		isReExport && targetSymbol.name !== exportSymbol.name ? targetSymbol.name : undefined;

	return withNamespaceDescriptors(
		{
			name: exportSymbol.name,
			symbol: targetSymbol,
			type,
			parentNamespaces,
			symbolScope,
			reexportedFrom,
		},
		[...namespaceDescriptors, ...targetNamespaceDescriptors],
	);
}

/**
 * Dispatches concrete declaration kinds to the descriptor builder that knows
 * how to acquire their symbol and type.
 *
 * Example: `export interface Props {}` is routed to the interface builder,
 * while `export type Mode = 'a' | 'b'` is routed to the type-alias builder.
 */
function resolveDeclarationExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.Declaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	if (ts.isExportAssignment(exportDeclaration)) {
		return resolveDefaultExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}

	if (ts.isVariableDeclaration(exportDeclaration) || ts.isFunctionDeclaration(exportDeclaration)) {
		return resolveValueExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}

	if (ts.isInterfaceDeclaration(exportDeclaration)) {
		return resolveInterfaceExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}

	if (ts.isEnumDeclaration(exportDeclaration)) {
		return resolveEnumExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}

	if (ts.isClassDeclaration(exportDeclaration)) {
		return resolveClassExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}

	if (ts.isTypeAliasDeclaration(exportDeclaration)) {
		return resolveTypeAliasExportDescriptor(
			exportSymbol,
			exportDeclaration,
			context,
			parentNamespaces,
			symbolScope,
		);
	}
}

/**
 * Handles `export default value` assignments.
 *
 * Example: `export default Button` resolves the symbol at `Button` and emits a
 * descriptor using the compiler's synthetic default export name.
 */
function resolveDefaultExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportAssignment,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.expression);
	if (!exportedSymbol) {
		console.error(
			'Failed to get the symbol of the default export in file:',
			context.sourceFile.fileName,
		);
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		symbolScope,
	};
}

/**
 * Handles value declarations exported directly from the module.
 *
 * Example: `export const useThing = ...` and `export function useThing() {}`
 * both resolve their declaration name and use `getTypeOfSymbol`.
 */
function resolveValueExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.VariableDeclaration | ts.FunctionDeclaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	if (!exportDeclaration.name) {
		return;
	}

	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		symbolScope,
	};
}

/**
 * Handles interface declarations and records explicit `extends` metadata.
 *
 * Example: `export interface AlertProps extends Dialog.Props {}` keeps
 * `extendsTypes` so consumers can see the authored inheritance relationship.
 */
function resolveInterfaceExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.InterfaceDeclaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeAtLocation(exportDeclaration),
		parentNamespaces,
		symbolScope,
		extendsTypes: extractExtendsTypes(exportDeclaration.heritageClauses, context.checker),
	};
}

/**
 * Handles enum declarations and emits the missing-enum warning when TypeScript
 * reports an enum symbol without a usable declaration.
 *
 * Example: `export enum Side { Start }` resolves through the enum declaration
 * before model construction.
 */
function resolveEnumExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.EnumDeclaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	const enumDeclaration = exportedSymbol.declarations?.[0];
	if (!enumDeclaration) {
		warnMissingEnumDeclaration(exportedSymbol, exportDeclaration, context);
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeAtLocation(enumDeclaration),
		parentNamespaces,
		symbolScope,
	};
}

/**
 * Handles class declarations as constructor types rather than instance types.
 *
 * Example: `export class Dialog {}` uses `getTypeOfSymbol` so construct
 * signatures are available to the class resolver.
 */
function resolveClassExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ClassDeclaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	if (!exportDeclaration.name) {
		return;
	}

	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		symbolScope,
	};
}

/**
 * Handles type aliases and preserves the authored type node for resolution.
 *
 * Example: `export type Value = 'a' | 'b'` stores the union syntax node so the
 * type resolver can preserve authored union structure and aliases.
 */
function resolveTypeAliasExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.TypeAliasDeclaration,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor | undefined {
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		type: context.checker.getTypeAtLocation(exportDeclaration),
		parentNamespaces,
		symbolScope,
		typeNode: exportDeclaration.type,
	};
}

function resolveExportSpecifierTarget(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	context: ParserContext,
): ts.Symbol | undefined {
	if (!isModuleReExportSpecifier(exportDeclaration)) {
		return context.checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
	}

	const aliasedSymbol = context.checker.getAliasedSymbol(exportSymbol);
	return aliasedSymbol && aliasedSymbol !== exportSymbol
		? aliasedSymbol
		: context.checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
}

function getExportSpecifierType(
	targetSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	context: ParserContext,
): ts.Type {
	const targetDeclaration = targetSymbol.declarations?.[0];
	if (targetDeclaration && ts.isImportSpecifier(targetDeclaration)) {
		const resolvedSymbol = context.checker.getAliasedSymbol(targetSymbol);
		const resolvedDeclaration = resolvedSymbol?.declarations?.[0];
		if (
			resolvedDeclaration &&
			(ts.isClassDeclaration(resolvedDeclaration) || ts.isClassExpression(resolvedDeclaration))
		) {
			return context.checker.getTypeOfSymbol(resolvedSymbol);
		}

		return context.checker.getTypeAtLocation(exportDeclaration);
	}

	if (
		targetDeclaration &&
		(ts.isClassDeclaration(targetDeclaration) || ts.isClassExpression(targetDeclaration))
	) {
		return context.checker.getTypeOfSymbol(targetSymbol);
	}

	if (targetDeclaration) {
		return context.checker.getTypeAtLocation(targetDeclaration);
	}

	return context.checker.getTypeOfSymbol(targetSymbol);
}

function resolveMergedNamespaceDescriptors(
	namespaceOwnerSymbol: ts.Symbol,
	namespaceExportName: string,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor[] {
	const namespaceDescriptors: ExportDescriptor[] = [];
	const declarations = namespaceOwnerSymbol.declarations;
	if (!declarations) {
		return namespaceDescriptors;
	}

	for (const declaration of declarations) {
		if (!ts.isModuleDeclaration(declaration)) {
			continue;
		}

		const namespaceSymbol = context.checker.getSymbolAtLocation(declaration.name);
		if (!namespaceSymbol) {
			continue;
		}

		namespaceDescriptors.push(
			...resolveNamespaceMemberDescriptors(
				namespaceSymbol,
				namespaceExportName,
				context,
				parentNamespaces,
				symbolScope,
			),
		);
	}

	return namespaceDescriptors;
}

function resolveNamespaceMemberDescriptors(
	namespaceSymbol: ts.Symbol,
	namespaceExportName: string,
	context: ParserContext,
	parentNamespaces: string[],
	symbolScope: string[],
): ExportDescriptor[] {
	const namespaceMembers = context.checker.getExportsOfModule(namespaceSymbol);
	const descriptors: ExportDescriptor[] = [];

	for (const member of namespaceMembers) {
		const memberDescriptors = resolveExportDescriptors(
			member,
			context,
			[...parentNamespaces, namespaceExportName],
			symbolScope,
		);
		if (memberDescriptors) {
			descriptors.push(...memberDescriptors);
		}
	}

	return descriptors;
}

function withNamespaceDescriptors(
	mainDescriptor: ExportDescriptor | undefined,
	namespaceDescriptors: ExportDescriptor[],
): ExportDescriptor[] | undefined {
	const descriptors = mainDescriptor
		? [mainDescriptor, ...namespaceDescriptors]
		: namespaceDescriptors;
	return asNonEmptyDescriptors(descriptors);
}

function asNonEmptyDescriptors(descriptors: ExportDescriptor[]): ExportDescriptor[] | undefined {
	return descriptors.length > 0 ? descriptors : undefined;
}

function isModuleReExportSpecifier(exportDeclaration: ts.ExportSpecifier): boolean {
	return (
		ts.isExportDeclaration(exportDeclaration.parent.parent) &&
		exportDeclaration.parent.parent.moduleSpecifier !== undefined
	);
}

function warnMissingEnumDeclaration(
	exportedSymbol: ts.Symbol,
	exportDeclaration: ts.EnumDeclaration,
	context: ParserContext,
): void {
	const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
		exportDeclaration.getStart(context.sourceFile),
	);

	context.onWarning({
		code: 'missing-enum-declaration',
		message: `Type extraction warning: Could not find the declaration of enum "${exportedSymbol.name}" at "${context.sourceFile.fileName}:${line + 1}:${character + 1}". Skipping this export.`,
		filePath: context.sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		parsedSymbolStack: [...context.parsedSymbolStack],
		enumName: exportedSymbol.name,
	});
}

/**
 * Extracts the type names from extends/implements clauses.
 * e.g., `interface X extends A, B.C` returns info for each extended type
 *
 * For utility types like Omit, Pick, Partial, etc., extracts the first type argument
 * as the base type being extended.
 */
function extractExtendsTypes(
	heritageClauses: ts.NodeArray<ts.HeritageClause> | undefined,
	checker: ts.TypeChecker,
): ExtendsTypeInfo[] | undefined {
	if (!heritageClauses) {
		return undefined;
	}

	// Utility types where the first type argument is the base type
	const utilityTypes = new Set(['Omit', 'Pick', 'Partial', 'Required', 'Readonly']);

	const extendsTypes: ExtendsTypeInfo[] = [];
	for (const clause of heritageClauses) {
		// Only process 'extends' clauses (SyntaxKind.ExtendsKeyword)
		// Skip 'implements' clauses for now
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}

		for (const typeExpr of clause.types) {
			const baseTypeName = typeExpr.expression.getText();

			// Check if this is a utility type wrapping another type
			// e.g., Omit<DialogRoot.Props, 'modal'> -> extract DialogRoot.Props
			if (
				utilityTypes.has(baseTypeName) &&
				typeExpr.typeArguments &&
				typeExpr.typeArguments.length > 0
			) {
				const firstTypeArg = typeExpr.typeArguments[0];
				// Get the base type name from the first type argument (without its own type arguments)
				const innerTypeName = ts.isTypeReferenceNode(firstTypeArg)
					? firstTypeArg.typeName.getText()
					: firstTypeArg.getText();

				// Try to resolve the actual symbol, following type alias chains
				const type = checker.getTypeAtLocation(firstTypeArg);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: innerTypeName };
				if (resolvedName && resolvedName !== innerTypeName && !isInternalSymbolName(resolvedName)) {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			} else {
				// Regular extends clause
				const type = checker.getTypeAtLocation(typeExpr);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: baseTypeName };
				if (resolvedName && resolvedName !== baseTypeName && !isInternalSymbolName(resolvedName)) {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			}
		}
	}

	return extendsTypes.length > 0 ? extendsTypes : undefined;
}

/**
 * Resolves the underlying symbol for a type, following type alias chains.
 * For generic type aliases like `type Props<T> = DialogProps<T>`, this returns
 * the symbol for `DialogProps` rather than `Props`.
 */
function resolveUnderlyingSymbol(type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined {
	const symbol = type.aliasSymbol ?? type.symbol;

	if (!symbol) {
		return undefined;
	}

	// For type aliases, follow the chain to find the underlying type
	// This handles generic type aliases like `type Props<T> = DialogProps<T>`
	const aliasDecl = symbol.declarations?.[0];
	if (aliasDecl && ts.isTypeAliasDeclaration(aliasDecl) && ts.isTypeReferenceNode(aliasDecl.type)) {
		// Get the symbol from the type reference name, not from the resolved type
		// This preserves the alias chain for generic types
		const targetTypeName = aliasDecl.type.typeName;
		const targetSymbol = checker.getSymbolAtLocation(targetTypeName);

		if (targetSymbol && !isInternalSymbolName(targetSymbol.name) && targetSymbol !== symbol) {
			// Check if the target is also a type alias - if so, recurse
			const targetDecl = targetSymbol.declarations?.[0];
			if (targetDecl && ts.isTypeAliasDeclaration(targetDecl)) {
				const targetType = checker.getDeclaredTypeOfSymbol(targetSymbol);
				const deeperSymbol = resolveUnderlyingSymbol(targetType, checker);
				if (deeperSymbol && deeperSymbol !== targetSymbol) {
					return deeperSymbol;
				}
			}
			return targetSymbol;
		}
	}

	return symbol;
}
