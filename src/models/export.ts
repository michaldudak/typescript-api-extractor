import { Documentation } from './documentation';
import { SerializableNode, TypeNode } from './node';

export class ExportNode implements SerializableNode {
	constructor(
		public name: string,
		public type: TypeNode,
		public documentation: Documentation | undefined,
	) {}

	/**
	 * Whether the export is public.
	 * Exports are considered public if they are not explicitly marked as private or internal.
	 */
	get isPublic() {
		return (
			this.documentation?.visibility !== 'private' && this.documentation?.visibility !== 'internal'
		);
	}

	toObject(): Record<string, unknown> {
		return {
			name: this.name,
			type: this.type.toObject(),
			documentation: this.documentation?.toObject(),
		};
	}
}
