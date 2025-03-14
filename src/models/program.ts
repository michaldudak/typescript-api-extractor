import { ModuleNode } from './module';
import { BaseNode } from './node';

export class ProgramNode implements BaseNode {
	constructor(public modules: ModuleNode[]) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'program',
			modules: this.modules.map((module) => module.toObject()),
		};
	}
}
