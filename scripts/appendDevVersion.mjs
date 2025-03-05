import fs from 'node:fs';

const packageJson = fs.readFileSync('./package.json', 'utf-8');
const packageJsonParsed = JSON.parse(packageJson);

const version = packageJsonParsed.version;
const now = new Date();

const newVersion = `${version}-dev.${now
	.toISOString()
	.replace(/[^0-9]/g, '')
	.slice(0, 12)}`;
const newPackageJson = {
	...packageJsonParsed,
	version: newVersion,
};

fs.writeFileSync('./package.json', JSON.stringify(newPackageJson, null, '\t'));
