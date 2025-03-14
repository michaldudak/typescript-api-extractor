import { MemberNode } from '../member';
import { TypeNode } from '../node';

export class ComponentNode implements TypeNode {
	kind = 'component';

	constructor(
		public name: string | undefined,
		public props: MemberNode[],
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
			props: this.props.map((prop) => prop.toObject()),
		};
	}
}
