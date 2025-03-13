import { MemberNode } from './member';

export class ComponentNode {
	constructor(
		public name: string | undefined,
		public props: MemberNode[],
	) {}
}
