import * as fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as rae from '../src';

interface RunOptions {
	files?: string[];
	configPath: string;
	includeExternal: boolean;
	out?: string;
}

function run(options: RunOptions) {
	const config = rae.loadConfig(options.configPath);
	const files = options.files ?? config.fileNames;

	const program = rae.createProgram(files, config.options);

	const components: any[] = [];
	const hooks: any[] = [];

	let errorCounter = 0;

	for (const file of files) {
		console.log(`Processing ${file}`);
		console.group();
		try {
			const ast = rae.parseFromProgram(file, program);

			const componentsApi = ast.body.filter(rae.isComponentNode).map((component) => {
				return {
					name: component.name,
					props: component.props
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

			const hooksApi = ast.body.filter(rae.isHookNode).map((hook) => {
				return {
					name: hook.name,
					parameters: hook.callSignatures[0].parameters.map((parameter) => {
						return {
							...parameter,
						};
					}),
					/*.filter(
						(prop) =>
							options.includeExternal ||
							!Array.from(prop.filenames).some((filename) => filename.includes('/node_modules/')),
					),*/
				};
			});

			components.push(...componentsApi);
			hooks.push(...hooksApi);
		} catch (e) {
			console.error(`⛔ Error processing ${file}: ${e.message}`);
			++errorCounter;
		} finally {
			console.groupEnd();
		}
	}

	const outputJSON = JSON.stringify({ components, hooks }, null, 2);
	if (options.out) {
		fs.writeFileSync(options.out, outputJSON);
		console.log(`Output written to ${options.out}`);
	} else {
		console.log(outputJSON);
	}

	console.log(`\nProcessed ${files.length} files.`);
	if (errorCounter > 0) {
		console.log(`❌ Found ${errorCounter} errors.`);
		process.exit(1);
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
					demandOption: false,
					description:
						'The files to extract the API descriptions from. If not provided, all files in the tsconfig.json are used',
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
				})
				.option('out', {
					alias: 'o',
					type: 'string',
					description: 'The output file. If not provided, the output is printed to the console',
				});
		},
		run,
	)
	.help()
	.strict()
	.version(false)
	.parse();
