import path from 'node:path';
import fs from 'node:fs';
import util from 'node:util';
import { it, expect } from 'vitest';
import glob from 'fast-glob';
import * as rae from '../src';

const testCases = glob.sync('**/input.{d.ts,ts,tsx}', { absolute: true, cwd: __dirname });

const program = rae.createProgram(
	testCases,
	rae.loadConfig(path.resolve(__dirname, '../tsconfig.json')),
);

for (const testCase of testCases) {
	const dirname = path.dirname(testCase);
	const testName = dirname.slice(__dirname.length + 1);
	const expectedOutput = path.join(dirname, 'output.txt');

	it(testName, async () => {
		const ast = rae.parseFromProgram(testCase, program);

		const newAST = rae.programNode(
			ast.body.map((component) => {
				expect(component.propsFilename).toBe(testCase);
				return {
					...component,
					types: component.types.map((type) => {
						delete type['$$id'];
						return {
							...type,
							filenames: new Set(),
						};
					}),
					propsFilename: undefined,
				};
			}),
		);

		console.log(util.inspect(newAST, { depth: null }));

		const expected = fs.readFileSync(expectedOutput, 'utf8');
		expect(util.inspect(newAST, { depth: null })).toEqual(expected);
	});
}
