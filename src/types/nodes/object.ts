import { Documentation } from '../documentation';
import { MemberNode } from './member';
import { BaseNode } from './node';

export class ObjectNode implements BaseNode {
	constructor(
		public name: string | undefined,
		public members: MemberNode[],
		public documentation: Documentation | undefined,
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'interface',
			name: this.name,
			members: this.members.map((member) => member.toObject()),
			documentation: this.documentation?.toObject(),
		};
	}
}
