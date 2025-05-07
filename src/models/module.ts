import { ExportNode } from './export';

export class ModuleNode {
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
