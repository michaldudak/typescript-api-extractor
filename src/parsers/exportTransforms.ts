import { ExportNode } from '../models';
import { ParserContext } from '../parser';
import { transformComponentExport } from './componentParser';

type ExportTransform = (node: ExportNode, context: ParserContext) => ExportNode;

const exportTransforms: ExportTransform[] = [transformComponentExport];

export function applyExportTransforms(nodes: ExportNode[], context: ParserContext): ExportNode[] {
	return nodes.map((node) =>
		exportTransforms.reduce(
			(transformedNode, transform) => transform(transformedNode, context),
			node,
		),
	);
}
