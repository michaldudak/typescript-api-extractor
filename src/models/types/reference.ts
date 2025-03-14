import { TypeNode } from '../node';

export class ReferenceNode implements TypeNode {
	kind = 'reference';

	constructor(public name: string) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
		};
	}
}
