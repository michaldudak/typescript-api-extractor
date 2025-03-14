import { ModuleNode } from './module';
import { SerializableNode } from './node';

export class ProgramNode implements SerializableNode {
	constructor(public modules: ModuleNode[]) {}

	toObject(): Record<string, unknown> {
		return {
			modules: this.modules.map((module) => module.toObject()),
		};
	}
}
