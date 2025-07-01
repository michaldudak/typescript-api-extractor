# TypeScript API Extractor

[![npm version](https://badge.fury.io/js/typescript-api-extractor.svg)](https://badge.fury.io/js/typescript-api-extractor)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A utility for extracting API descriptions from [TypeScript](https://www.npmjs.com/package/typescript) definitions using the TypeScript Compiler API. This tool analyzes TypeScript source code and generates structured metadata about exported functions, components, interfaces, types, and more.

## Features

- 🔍 **Extract API information** from TypeScript source files
- ⚛️ **React component analysis** with prop types and documentation
- 🏷️ **Type definitions** including interfaces, enums, and type aliases
- 📝 **JSDoc comments** parsing and extraction
- 🔗 **Reference resolution** for complex type relationships
- 🎯 **Selective parsing** of specific files or entire projects

## Installation

```bash
npm install typescript-api-extractor
```

or with yarn:

```bash
yarn add typescript-api-extractor
```

or with pnpm:

```bash
pnpm add typescript-api-extractor
```

## Usage

```typescript
import ts from 'typescript';
import { loadConfig, parseFromProgram, type ModuleNode } from 'typescript-api-extractor';

// Load TypeScript configuration
const config = loadConfig('./tsconfig.json');
const program = ts.createProgram(config.fileNames, config.options);

// Parse all files in the project
for (const file of config.fileNames) {
	try {
		const moduleInfo: ModuleNode = parseFromProgram(file, program);
		console.log(`Extracted API from ${file}:`, moduleInfo);
	} catch (error) {
		console.error(`Failed to parse ${file}:`, error);
	}
}
```

## API Reference

### `loadConfig(tsConfigPath: string)`

Loads and parses a TypeScript configuration file.

- **Parameters:**
  - `tsConfigPath`: Path to the `tsconfig.json` file
- **Returns:** `{ options: ts.CompilerOptions, fileNames: string[] }`

### `parseFile(filePath: string, options: ts.CompilerOptions, parserOptions?: ParserOptions)`

Parses a single TypeScript file and returns the extracted API information.

- **Parameters:**
  - `filePath`: Path to the TypeScript file to parse
  - `options`: TypeScript compiler options
  - `parserOptions`: Optional parser configuration
- **Returns:** `ModuleNode`

### `parseFromProgram(filePath: string, program: ts.Program, parserOptions?: ParserOptions)`

Parses a file from an existing TypeScript program for better performance when parsing multiple files.

- **Parameters:**
  - `filePath`: Path to the file to parse
  - `program`: TypeScript program instance
  - `parserOptions`: Optional parser configuration
- **Returns:** `ModuleNode`

## Configuration Options

The parser accepts optional configuration through the `ParserOptions` interface:

```typescript
interface ParserOptions {
	includePrivateMembers?: boolean;
	followReferences?: boolean;
	maxDepth?: number;
}
```

## Output Format

The parser returns a `ModuleNode` object with the following structure:

```typescript
interface ModuleNode {
	name: string;
	exports: ExportNode[];
}

interface ExportNode {
	name: string;
	type: TypeNode;
	documentation?: DocumentationNode;
}
```

`TypeNode` represents a TypeScript type. There are multiple classes of types. See the contents of the `src/models/types` directory to discover them.

### Example Output

For a React component like this:

```typescript
interface Props {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
}

export function MyComponent(props: Props) {
  return <div>{props.title}</div>;
}
```

The extractor would produce:

```json
{
	"name": "MyComponent",
	"exports": [
		{
			"name": "MyComponent",
			"type": {
				"kind": "component",
				"name": "MyComponent",
				"props": [
					{
						"name": "title",
						"type": {
							"kind": "intrinsic",
							"intrinsic": "string"
						},
						"optional": false,
						"documentation": {
							"description": "The title to display"
						}
					},
					{
						"name": "disabled",
						"type": {
							"kind": "intrinsic",
							"intrinsic": "boolean"
						},
						"optional": true,
						"documentation": {
							"description": "Whether the component is disabled"
						}
					}
				]
			}
		}
	]
}
```

## Requirements

- **Node.js**: >= 18.0.0
- **TypeScript**: ^5.8 (peer dependency)

Make sure you have TypeScript installed in your project:

```bash
npm install typescript
```

## License

This project is licensed under the terms of the [MIT license](/LICENSE).

## Acknowledgments

This project was started as a fork of [typescript-to-proptypes](https://github.com/merceyz/typescript-to-proptypes) created by [Kristoffer K.](https://github.com/merceyz).
