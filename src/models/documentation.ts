import { SerializableNode } from './node';

export class Documentation implements SerializableNode {
	constructor(
		public description: string | undefined,
		public defaultValue: unknown | undefined = undefined,
		public visibility: 'public' | 'private' | 'internal' | undefined,
		public tags: DocumentationTag[] = [],
	) {}

	hasTag(name: string): boolean {
		return this.tags.some((tag) => tag.name === name);
	}

	getTagValue(name: string): string | undefined {
		return this.tags.find((tag) => tag.name === name)?.name;
	}

	toObject(): Record<string, unknown> {
		return {
			description: this.description,
			defaultValue: this.defaultValue,
			visibility: this.visibility,
			tags: this.tags.length > 0 ? this.tags : undefined,
		};
	}
}

export interface DocumentationTag {
	name: string;
	value: string | undefined;
}
