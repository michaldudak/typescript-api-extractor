import { expect, it } from 'vitest';
import {
	CallSignature,
	ComponentNode,
	Documentation,
	ExportNode,
	ExternalTypeNode,
	FunctionNode,
	IntrinsicNode,
	TypeName,
	UnionNode,
	type AnyType,
	type ExtendsTypeInfo,
	type ParserContext,
} from '../src';
import { isComponentExport } from '../src/parsers/componentParser';
import { applyExportTransforms } from '../src/parsers/exportTransforms';

const parserContext = {
	compilerOptions: {},
} as ParserContext;

function createFunctionNode(
	returnValueType: AnyType = new ExternalTypeNode(new TypeName('ReactElement')),
) {
	return new FunctionNode(new TypeName('Button'), [new CallSignature([], returnValueType)]);
}

it('classifies component exports separately from export transformation', () => {
	expect(isComponentExport(new ExportNode('Button', createFunctionNode(), undefined))).toBe(true);
	expect(isComponentExport(new ExportNode('default', createFunctionNode(), undefined))).toBe(true);
	expect(
		isComponentExport(
			new ExportNode(
				'Button',
				createFunctionNode(
					new UnionNode(undefined, [
						new IntrinsicNode('null'),
						new ExternalTypeNode(new TypeName('ReactNode')),
					]),
				),
				undefined,
			),
		),
	).toBe(true);
	expect(isComponentExport(new ExportNode('button', createFunctionNode(), undefined))).toBe(false);
	expect(
		isComponentExport(
			new ExportNode('Button', createFunctionNode(new IntrinsicNode('string')), undefined),
		),
	).toBe(false);
});

it('applies component transforms without losing export metadata', () => {
	const documentation = new Documentation('Root component.');
	const extendsTypes: ExtendsTypeInfo[] = [{ name: 'Dialog.Props', resolvedName: 'DialogProps' }];
	const exportNode = new ExportNode(
		'Button',
		createFunctionNode(),
		documentation,
		'InternalButton',
		extendsTypes,
	);

	const transformedNode = applyExportTransforms([exportNode], parserContext)[0]!;

	expect(transformedNode).not.toBe(exportNode);
	expect(transformedNode.type).toBeInstanceOf(ComponentNode);
	expect(transformedNode.name).toBe('Button');
	expect(transformedNode.documentation).toBe(documentation);
	expect(transformedNode.reexportedFrom).toBe('InternalButton');
	expect(transformedNode.extendsTypes).toBe(extendsTypes);
});

it('keeps non-component exports unchanged', () => {
	const exportNode = new ExportNode('button', createFunctionNode(), undefined);

	expect(applyExportTransforms([exportNode], parserContext)[0]).toBe(exportNode);
});
