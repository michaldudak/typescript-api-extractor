import { Documentation } from './documentation';
import { AnyType } from './node';

export class ExportNode {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		/**
		 * Present when this export is re-exported from a different namespace.
		 *
		 * For example, `AlertDialog.Trigger` re-exports `DialogTrigger`, so
		 * `inheritedFrom` would be "Dialog". This is only set when it differs
		 * from the type's own namespace.
		 */
		public inheritedFrom?: string,
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
