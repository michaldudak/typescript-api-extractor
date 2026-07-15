import path from 'node:path';
import { expect, it } from 'vitest';
import { parseFromProgram } from '../../parser';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

it('keeps type parameters from expanded external aliases generic', () => {
	// Keep the virtual entry under the repository so TypeScript resolves the
	// installed React declarations exactly as it does for a consumer project.
	const filePath = path.resolve('src/parsers/typeResolvers/external-type-parameter.ts');
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`import * as React from 'react';

export type PropsFor<ElementType extends React.ElementType> =
  React.ComponentPropsWithRef<ElementType>;`,
				),
				{ includeExternalTypes: false },
			),
		),
	);
	const propsType = moduleDefinition.exports[0]?.type;

	expect(propsType.types[0].types[0].typeName.typeArguments[0].type).toMatchObject({
		kind: 'typeParameter',
		name: 'Props',
	});
	expect(propsType.types[1]).toMatchObject({
		kind: 'typeParameter',
		name: 'Props',
	});
});

it('routes built-in arrays around external fallback while keeping external aliases opaque', () => {
	const filePath = '/virtual/array-external-fallback-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `export type Mutable = Array<string>;
export type ReadonlyValues = ReadonlyArray<string>;
export type { ExternalList } from 'external-array-package';`,
					'/virtual/node_modules/external-array-package/index.d.ts':
						'export type ExternalList = string[];',
				}),
			),
		),
	);
	const exportByName = (name: string) =>
		moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name);

	expect(exportByName('Mutable')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
	});
	expect(exportByName('Mutable')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('ReadonlyValues')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
		isReadonly: true,
	});
	expect(exportByName('ExternalList')?.type).toMatchObject({
		kind: 'external',
		typeName: { name: 'ExternalList' },
	});
});
