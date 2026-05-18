import ts from 'typescript';
import { ExportNode, TypeName, type AnyType } from '../models';
import { ParserError } from '../ParserError';
import { type ParserContext } from '../parser';
import { isInternalSymbolName } from './common';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ExportDescriptor, resolveExportDescriptors } from './exportDescriptors';
import { resolveType } from './typeResolver';

/**
 * Returns a shallow copy of a type node with a different typeName.
 * Avoids mutating the original, which may be shared via the resolved-type cache.
 *
 * Example: an anonymous external re-export that resolved as `__type` can be
 * copied with the public export name `Rect`.
 */
function withTypeName<T extends AnyType>(node: T, typeName: TypeName): T {
	return Object.assign(Object.create(Object.getPrototypeOf(node) as object), node, {
		typeName,
	}) as T;
}

/**
 * Converts one TypeScript module export symbol into output `ExportNode`s.
 *
 * Example: `export { ComponentRoot as Root }` becomes a descriptor for `Root`
 * plus descriptors for merged namespace members such as `Root.Props`.
 */
export function parseExport(
	exportSymbol: ts.Symbol,
	parserContext: ParserContext,
	parentNamespaces: string[] = [],
): ExportNode[] | undefined {
	const descriptors = resolveExportDescriptors(exportSymbol, parserContext, parentNamespaces);
	if (!descriptors) {
		return;
	}

	const exports = descriptors.flatMap(
		(descriptor) => createExportNodesFromDescriptor(descriptor, parserContext) ?? [],
	);

	return exports.length > 0 ? exports : undefined;
}

/**
 * Builds the final output node for a normalized export descriptor.
 *
 * Example: a `Props` descriptor under parent namespace `Root` becomes an
 * `ExportNode` named `Root.Props`.
 */
function createExportNodesFromDescriptor(
	descriptor: ExportDescriptor,
	parserContext: ParserContext,
): ExportNode[] | undefined {
	return runWithSymbolScopes(parserContext, descriptor.symbolScope, () => {
		try {
			const sourceNode = descriptor.typeNode ?? descriptor.symbol.declarations?.[0];

			return parserContext.runWithSourceNodeScope(sourceNode, () => {
				let parsedType = resolveType(descriptor.type, descriptor.typeNode, parserContext);
				if (!parsedType) {
					return;
				}

				parsedType = applyExportTypeNameContext(parsedType, descriptor);
				const exportName =
					descriptor.parentNamespaces.length > 0
						? [...descriptor.parentNamespaces, descriptor.name].join('.')
						: descriptor.name;

				return [
					new ExportNode(
						exportName,
						parsedType,
						getDocumentationFromSymbol(descriptor.symbol, parserContext.checker),
						descriptor.reexportedFrom,
						descriptor.extendsTypes,
					),
				];
			});
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, parserContext.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Applies public export naming to resolved type nodes without re-resolving them.
 *
 * Example: `export * as Component` should expose `Component.Root`, even if the
 * underlying declaration was originally named `ComponentRoot`.
 */
function applyExportTypeNameContext<T extends AnyType>(
	parsedType: T,
	descriptor: ExportDescriptor,
): T {
	if (!('typeName' in parsedType)) {
		return parsedType;
	}

	const oldTypeName = (parsedType as { typeName: TypeName | undefined }).typeName;

	// Fix type names for resolved anonymous/internal symbols. Re-exported aliases
	// can otherwise lose their authored export name and surface as `__type`.
	if (oldTypeName?.name != null && isInternalSymbolName(oldTypeName.name)) {
		return withTypeName(
			parsedType,
			new TypeName(descriptor.name, oldTypeName.namespaces, oldTypeName.typeArguments),
		);
	}

	// Namespace exports define a new public reference path, so the exported node
	// should use the namespace context even when the underlying type came from
	// another module or declaration name.
	if (descriptor.parentNamespaces.length > 0) {
		return withTypeName(
			parsedType,
			new TypeName(descriptor.name, descriptor.parentNamespaces, oldTypeName?.typeArguments),
		);
	}

	return parsedType;
}

/**
 * Replays the descriptor's symbol stack around output-node construction.
 *
 * Example: a namespace member descriptor with scope `['Root', 'Props']` pushes
 * both entries while type-resolution warnings are produced.
 */
function runWithSymbolScopes<T>(
	parserContext: ParserContext,
	symbolScope: string[],
	callback: () => T,
): T {
	const [symbolName, ...remainingSymbolScope] = symbolScope;
	if (!symbolName) {
		return callback();
	}

	return parserContext.runWithSymbolScope(symbolName, () =>
		runWithSymbolScopes(parserContext, remainingSymbolScope, callback),
	);
}
