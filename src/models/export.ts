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
