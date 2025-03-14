import { MemberNode } from './member';
import { BaseNode } from './node';

export class ComponentNode implements BaseNode {
	constructor(
		public name: string | undefined,
		public props: MemberNode[],
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'component',
			name: this.name,
			props: this.props.map((prop) => prop.toObject()),
		};
	}
}
