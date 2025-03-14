import { ExportNode } from './export';
import { SerializableNode } from './node';

export class ModuleNode implements SerializableNode {
	constructor(
		public name: string,
		public exports: ExportNode[],
	) {}

	toObject(): Record<string, unknown> {
		return {
			name: this.name,
			exports: this.exports.map((exportNode) => exportNode.toObject()),
		};
	}
}
