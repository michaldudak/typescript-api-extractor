import { BaseNode } from './node';

export class ReferenceNode implements BaseNode {
	constructor(public typeName: string) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'reference',
			typeName: this.typeName,
		};
	}
}
