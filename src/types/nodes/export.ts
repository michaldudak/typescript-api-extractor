import { Documentation } from '../documentation';
import { TypeNode } from './node';

export class ExportNode {
	constructor(
		public name: string,
		public type: TypeNode,
		public documentation: Documentation | undefined,
	) {}

	/**
	 * Whether the export is public.
	 * Exports are considered public if they are not explicitly marked as private or internal.
	 */
	public get isPublic() {
		return (
			this.documentation?.visibility !== 'private' && this.documentation?.visibility !== 'internal'
		);
	}
}
