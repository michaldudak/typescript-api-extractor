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
