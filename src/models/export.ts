import { Documentation } from './documentation';
import { AnyType } from './node';

/**
 * Information about an extended type.
 */
export interface ExtendsTypeInfo {
	/** The name as written in the source code, e.g., "Dialog.Props" */
	name: string;
	/** The resolved symbol name if different from the written name, e.g., "DialogProps" */
	resolvedName?: string;
}

export class ExportNode {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		/**
		 * Whether the export occupies TypeScript's value declaration space, i.e.
		 * exists at runtime.
		 *
		 * For example, `export const x = 'x'`, functions, classes, and enums are
		 * values, while `export type X = 'x'` and lone interfaces are not. Merged
		 * declarations such as `interface X {}` + `const X: X` are values.
		 */
		public isValue: boolean,
		/**
		 * Whether the export occupies TypeScript's type declaration space, i.e.
		 * names a type.
		 *
		 * For example, type aliases, interfaces, classes, and enums are types,
		 * while `export const x = 'x'` and plain functions are not.
		 */
		public isType: boolean,
		/**
		 * Whether the export occupies TypeScript's namespace declaration space.
		 *
		 * For example, `export namespace N {}` declares a namespace, possibly
		 * merged with a function or class of the same name. A namespace
		 * containing only types is neither a value nor a type, only a namespace.
		 */
		public isNamespace: boolean,
		/**
		 * The full original name when this export is a re-export with a different name.
		 *
		 * For example, `export { DialogTrigger as Trigger }` would have
		 * `reexportedFrom: "DialogTrigger"`. This allows consumers to build
		 * a map of re-exports for type compatibility tracking.
		 */
		public reexportedFrom?: string,
		/**
		 * The type(s) this export explicitly extends.
		 *
		 * For example, `interface AlertDialogRootProps extends Dialog.Props`
		 * would have `extendsTypes: [{ name: "Dialog.Props", resolvedName: "DialogProps" }]`.
		 * This allows consumers to track type compatibility for inherited components.
		 */
		public extendsTypes?: ExtendsTypeInfo[],
	) {}

	withType(type: AnyType): ExportNode {
		return new ExportNode(
			this.name,
			type,
			this.documentation,
			this.isValue,
			this.isType,
			this.isNamespace,
			this.reexportedFrom,
			this.extendsTypes,
		);
	}

	/**
	 * Whether the export is public.
	 * Exports are considered public if they are not explicitly marked as private or internal.
	 *
	 * @param requireExplicitAnnotation Whether the export must have an explicit visibility annotation to be considered public.
	 */
	isPublic(requireExplicitAnnotation = false): boolean {
		if (requireExplicitAnnotation) {
			return this.documentation?.visibility === 'public';
		}

		return (
			this.documentation?.visibility !== 'private' && this.documentation?.visibility !== 'internal'
		);
	}
}
