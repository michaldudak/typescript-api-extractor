import { expect, it } from 'vitest';
import {
	CallSignature,
	ComponentNode,
	Documentation,
	ExportNode,
	ExternalTypeNode,
	FunctionNode,
	IntrinsicNode,
	ObjectNode,
	Parameter,
	PropertyNode,
	TypeName,
	UnionNode,
	type AnyType,
	type ExtendsTypeInfo,
	type ParserContext,
} from '../index';
import { isComponentExport } from './componentParser';
import { applyExportTransforms } from './exportTransforms';

const parserContext = {
	compilerOptions: {},
} as ParserContext;

function createFunctionNode(
	returnValueType: AnyType = new ExternalTypeNode(new TypeName('ReactElement')),
	typeName = 'Button',
	propNames: string[] = [],
) {
	const props = propNames.map(
		(propName) => new PropertyNode(propName, new IntrinsicNode('string'), undefined, false),
	);
	const parameters =
		props.length > 0
			? [
					new Parameter(
						new ObjectNode(undefined, props, undefined),
						'props',
						undefined,
						false,
						undefined,
					),
				]
			: [];

	return new FunctionNode(new TypeName(typeName), [new CallSignature(parameters, returnValueType)]);
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

it('classifies a union of component-like functions as a component export', () => {
	const componentUnion = new UnionNode(undefined, [
		createFunctionNode(undefined, 'ToolbarRoot', ['children']),
		createFunctionNode(undefined, 'ToolbarWithRender', ['render']),
	]);

	expect(isComponentExport(new ExportNode('Toolbar', componentUnion, undefined))).toBe(true);
});

it('keeps unions with a non-component member out of the component classification', () => {
	const partialUnion = new UnionNode(undefined, [
		createFunctionNode(undefined, 'ToolbarRoot', ['children']),
		new IntrinsicNode('undefined'),
	]);

	expect(isComponentExport(new ExportNode('Toolbar', partialUnion, undefined))).toBe(false);
});

it('merges the props of every union member into one component', () => {
	const componentUnion = new UnionNode(undefined, [
		createFunctionNode(undefined, 'ToolbarRoot', ['children', 'className']),
		createFunctionNode(undefined, 'ToolbarWithRender', ['render', 'className']),
	]);
	const exportNode = new ExportNode('Toolbar', componentUnion, undefined);

	const componentNode = applyExportTransforms([exportNode], parserContext)[0]!
		.type as ComponentNode;

	expect(componentNode).toBeInstanceOf(ComponentNode);
	expect(componentNode.props.map((prop) => prop.name).sort()).toEqual([
		'children',
		'className',
		'render',
	]);
	// `className` comes from both members, so it stays required; the other two are
	// specific to one member and only apply to that form of the component.
	expect(componentNode.props.filter((prop) => prop.optional).map((prop) => prop.name)).toEqual([
		'children',
		'render',
	]);
	// No single member name describes the merged component.
	expect(componentNode.typeName).toBeUndefined();
});

it('keeps the shared type name when every union member agrees on it', () => {
	const componentUnion = new UnionNode(undefined, [
		createFunctionNode(undefined, 'Toolbar', ['children']),
		createFunctionNode(undefined, 'Toolbar', ['render']),
	]);
	const exportNode = new ExportNode('Toolbar', componentUnion, undefined);

	const componentNode = applyExportTransforms([exportNode], parserContext)[0]!
		.type as ComponentNode;

	expect(componentNode.typeName?.name).toBe('Toolbar');
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
