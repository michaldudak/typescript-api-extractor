import { Documentation } from './documentation';
import { AnyType } from './node';

export class PropertyNode {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		public optional: boolean,
	) {}
}
