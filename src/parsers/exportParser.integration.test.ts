import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

const namespaceExternalAnonymousSource = 'export const thing: { value: number };';

it('preserves namespace type names when anonymous external members are namespace exported', () => {
	const filePath = '/virtual/namespace-external.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: "export * as NS from './node_modules/pkg/index';",
			'/virtual/node_modules/pkg/index.d.ts': namespaceExternalAnonymousSource,
		}),
	);

	// Anonymous object declarations from external files can resolve through the
	// internal `__type` symbol. Export parsing must repair that name before
	// applying the namespace context so the public type path remains `NS.thing`.
	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'external',
		typeName: {
			name: 'thing',
			namespaces: ['NS'],
		},
	});
});
