import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { loadConfig, parseFromProgram } from '../../index';

const fixturesDir = path.resolve(__dirname, '../../../test/fixtures');
const mappedAliasFiniteKeyInput = path.join(fixturesDir, 'mapped-alias-finite-key/input.ts');
const program = ts.createProgram(
	[mappedAliasFiniteKeyInput],
	loadConfig(path.resolve(__dirname, '../../../test/tsconfig.json')).options,
);

it('applies shouldInclude to finite mapped properties', async () => {
	const moduleDefinition = parseFromProgram(mappedAliasFiniteKeyInput, program, {
		shouldInclude: ({ name }) => name !== 'b',
	});
	const serializedModuleDefinition = JSON.parse(JSON.stringify(moduleDefinition));
	const specializedExport = serializedModuleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Specialized',
	);

	expect(
		specializedExport.type.properties.map((property: { name: string }) => property.name),
	).toEqual(['a']);
});
