import fs from 'node:fs';
import pretter from 'prettier';

const pretterConfig = await pretter.resolveConfig('./package.json');
const packageJson = fs.readFileSync('./package.json', 'utf-8');
const packageJsonParsed = JSON.parse(packageJson);

const version = packageJsonParsed.version;
const newVersion = version.replace(/-dev.*$/, '');

const newPackageJson = {
	...packageJsonParsed,
	version: newVersion,
};

let newContent = JSON.stringify(newPackageJson, null, '\t');
newContent = await pretter.format(newContent, { ...pretterConfig, parser: 'json' });

fs.writeFileSync('./package.json', newContent);
