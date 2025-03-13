import { MemberNode } from './member';

export interface ObjectNode {
	name: string | undefined;

	members: MemberNode[];
}

export class ObjectNode {
	constructor(
		public name: string | undefined = undefined,
		public members: MemberNode[] = [],
	) {}
}
