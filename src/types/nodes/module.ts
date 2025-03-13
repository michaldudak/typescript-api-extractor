import { ExportNode } from './export';

export class ModuleNode {
	constructor(
		public name: string,
		public exports: ExportNode[],
	) {}
}
