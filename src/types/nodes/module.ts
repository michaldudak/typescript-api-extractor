import { ExportNode } from './export';
import { BaseNode } from './node';

export class ModuleNode implements BaseNode {
	constructor(
		public name: string,
		public exports: ExportNode[],
	) {}

	toObject(): Record<string, unknown> {
		return {
			nodeType: 'module',
			name: this.name,
			exports: this.exports.map((exportNode) => exportNode.toObject()),
		};
	}
}
