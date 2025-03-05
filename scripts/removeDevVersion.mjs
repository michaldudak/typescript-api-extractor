import fs from 'node:fs';

const packageJson = fs.readFileSync('./package.json', 'utf-8');
const packageJsonParsed = JSON.parse(packageJson);

const version = packageJsonParsed.version;
const newVersion = version.replace(/-dev.*$/, '');

const newPackageJson = {
	...packageJsonParsed,
	version: newVersion,
};

fs.writeFileSync('./package.json', JSON.stringify(newPackageJson, null, '\t'));
