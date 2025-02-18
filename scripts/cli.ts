import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as rae from '../src';

const INCLUDE_EXTERNAL = false;

interface RunOptions {
	files: string[];
	configPath: string;
	includeExternal: boolean;
}

function run(options: RunOptions) {
	const program = rae.createProgram(options.files, rae.loadConfig(options.configPath));

	for (const file of options.files) {
		const ast = rae.parseFromProgram(file, program);

		const translated = ast.body.map((component) => {
			return {
				name: component.name,
				props: component.types
					.map((prop) => {
						return {
							...prop,
							filenames: Array.from(prop.filenames),
						};
					})
					.filter(
						(prop) =>
							options.includeExternal ||
							!Array.from(prop.filenames).some((filename) => filename.includes('/node_modules/')),
					),
			};
		});

		console.log(JSON.stringify(translated, null, 2));
	}
}

yargs(hideBin(process.argv))
	.command<RunOptions>(
		'$0',
		'Extracts the API descriptions from a set of files',
		(command) => {
			return command
				.option('files', {
					alias: 'f',
					type: 'array',
					demandOption: true,
					description: 'The files to extract the API descriptions from',
				})
				.option('configPath', {
					alias: 'c',
					type: 'string',
					demandOption: true,
					description: 'The path to the tsconfig.json file',
				})
				.option('includeExternal', {
					alias: 'e',
					type: 'boolean',
					default: false,
					description: 'Include props defined outside of the project',
				});
		},
		run,
	)
	.help()
	.strict()
	.version(false)
	.parse();
