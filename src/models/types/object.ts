import { TypeNode } from '../node';
import { Documentation } from '../documentation';
import { MemberNode } from '../member';

export class ObjectNode implements TypeNode {
	kind = 'object';

	constructor(
		public name: string | undefined,
		public members: MemberNode[],
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			kind: this.kind,
			name: this.name,
			members: this.members.map((member) => member.toObject()),
			documentation: this.documentation?.toObject(),
		};
	}
}
