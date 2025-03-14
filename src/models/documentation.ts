import { SerializableNode } from './node';

export class Documentation implements SerializableNode {
	constructor(
		public description: string | undefined,
		public defaultValue: any | undefined = undefined,
		public visibility: 'public' | 'private' | 'internal' = 'public',
		public tags: DocumentationTag[] = [],
	) {}

	toObject(): Record<string, unknown> {
		return {
			description: this.description,
			defaultValue: this.defaultValue,
			visibility: this.visibility === 'public' ? undefined : this.visibility,
			tags: this.tags.length > 0 ? this.tags : undefined,
		};
	}
}

export interface DocumentationTag {
	name: string;
	value: string | undefined;
}
