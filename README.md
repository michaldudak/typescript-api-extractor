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
import {
	createProgram,
	loadConfig,
	parseFromProgram,
	type ModuleNode,
} from 'typescript-api-extractor';

// Load TypeScript configuration
const config = loadConfig('./tsconfig.json');
const program = createProgram(config.fileNames, config.options);

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

### `createProgram`

Re-export of TypeScript’s `createProgram` from the TypeScript version bundled with `typescript-api-extractor`. It has the same overloads/signature as `typescript.createProgram` and returns a `Program`.

### `loadConfig(tsConfigPath: string)`

Loads and parses a TypeScript configuration file.

- **Parameters:**
  - `tsConfigPath`: Path to the `tsconfig.json` file
- **Returns:** `{ options: CompilerOptions, fileNames: string[] }`

### `parseFile(filePath: string, options: CompilerOptions, parserOptions?: ParserOptions)`

Parses a single TypeScript file and returns the extracted API information.

- **Parameters:**
  - `filePath`: Path to the TypeScript file to parse
  - `options`: TypeScript compiler options
  - `parserOptions`: Optional parser configuration
- **Returns:** `ModuleNode`

### `parseFromProgram(filePath: string, program: Program, parserOptions?: ParserOptions)`

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
	shouldInclude?: (data: { name: string; depth: number }) => boolean | undefined;
	shouldResolveObject?: (data: {
		name: string;
		propertyCount: number;
		depth: number;
	}) => boolean | undefined;
	includeExternalTypes?: boolean;
	onWarning?: (warning: ParserWarning) => void;
}

type ParserWarning =
	| UnsupportedTypeFallbackWarning
	| MissingEnumDeclarationWarning
	| MissingDefaultExportSymbolWarning;

interface ParserWarningBase {
	message: string;
	filePath: string;
	line: number;
	column: number;
	parsedSymbolStack: string[];
}

interface UnsupportedTypeFallbackWarning extends ParserWarningBase {
	code: 'unsupported-type-fallback';
	typeFlags: string[];
	typeText: string;
	sourceText?: string;
}

interface MissingEnumDeclarationWarning extends ParserWarningBase {
	code: 'missing-enum-declaration';
	enumName: string;
}

interface MissingDefaultExportSymbolWarning extends ParserWarningBase {
	code: 'missing-default-export-symbol';
	sourceText: string;
}
```

When `onWarning` is omitted, recoverable parser warnings are printed with
`console.warn`. Provide `onWarning` to collect or format them yourself.

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

### Type Operators

Authored `keyof` expressions are represented without expanding away their syntax:

```typescript
interface TypeOperatorNode {
	kind: 'typeOperator';
	operator: 'keyof';
	type: TypeNode;
	resolvedType: TypeNode;
	resolutionKind: 'exact' | 'baseConstraint' | 'fallback';
}
```

- `type` is the authored operand. Named object operands are intentionally shallow
  references because expanding their properties does not change the operator or
  its key result.
- `resolvedType` is the checker result used to describe the keys available from
  the operator.
- `resolutionKind: 'exact'` means `resolvedType` is the concrete result.
- `resolutionKind: 'baseConstraint'` means the operand is still generic, so
  `resolvedType` is the best available base constraint rather than its eventual
  instantiated result. For example, `keyof T` commonly resolves to
  `string | number | symbol` at extraction time.
- `resolutionKind: 'fallback'` means the checker exposed neither a concrete
  result nor a usable base constraint; `resolvedType` is `any`.

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

`ModuleNode.name` is the parsed file path relative to `compilerOptions.rootDir`,
including the file extension. For a file at `src/MyComponent.ts`, the extractor
would produce:

```json
{
	"name": "src/MyComponent.ts",
	"exports": [
		{
			"name": "MyComponent",
			"type": {
				"kind": "component",
				"typeName": {
					"name": "MyComponent"
				},
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

## Technical Notes

The parser code is split into a few layers. Type-class modules live in the
resolver pipeline: each one chooses whether a TypeScript type shape applies and
constructs the corresponding output model node. Shared helpers exist only for
substructures that are reused across multiple type classes.

### Architecture Principles

- Keep normalization and construction as separate phases. Export parsing first
  creates `ExportDescriptor` records, then converts them into `ExportNode`
  models once export targeting, namespace metadata, and re-export metadata are
  stable.
- Keep type resolution as an ordered pipeline. Resolver order is observable for
  overlapping TypeScript shapes, so broad fallback resolvers should stay behind
  more specific resolvers.
- Keep parser context scoped. Parser code should use the internal
  `ScopedParserContext` scope helpers for symbol stacks, source-node stacks, and
  type-parameter substitutions instead of mutating ambient parser state directly.
  The public `ParserContext` stays the observable parser state and options shape.
- Keep model policy centralized. Type model classes are DTO-like and can render
  themselves, while compound normalization and structural equivalence live in
  dedicated model helpers.

### Entry Points

- `src/parsers/moduleParser.ts` and `src/parsers/exportParser.ts` walk source files
  and exported declarations.
- `src/parsers/exportDescriptors.ts` normalizes export symbols into
  `ExportDescriptor` records before any output model nodes are built. It owns
  export-specifier targeting, namespace merging, re-export metadata, export type
  acquisition, and recoverable export warnings.
- `src/parsers/exportTransforms.ts` applies post-export transforms after generic
  export nodes are built. Today it runs the React component transform from
  `componentParser.ts`.
- `src/parsers/componentParser.ts` contains React component-specific extraction
  and should remain a transform policy rather than a generic export parser.
- `src/parsers/typeResolver.ts` is the public type-resolution facade used by the
  rest of the parser. It should stay small; the resolver implementation lives in
  the session and resolver modules.

### Type Resolution

- `src/parsers/typeResolutionSession.ts` owns cross-cutting resolution mechanics:
  caching, recursion guards, type-parameter substitutions, warning replay, and
  the active resolver callback used by nested type-class handlers and helpers.
- `src/parsers/typeResolutionTypes.ts` defines the contracts shared by the
  resolver pipeline. Resolvers receive a `TypeResolutionRequest` and a
  `TypeResolutionSession`.
- `ScopedParserContext` (in `src/parserContext.ts`) exposes scoped parser-context
  helpers for diagnostic symbol scopes, diagnostic source-node scopes, and
  temporary type-parameter substitutions. Parser code should use these helpers
  instead of manually pushing and popping diagnostic stacks or swapping
  substitution maps. The public `ParserContext` (exported from `src/parser.ts`)
  stays focused on observable parser state and options.
- `src/parsers/typeResolutionDiagnostics.ts` centralizes recoverable fallback
  warnings, including source-location selection and TypeScript flag formatting.
- `src/parsers/typeResolutionUtils.ts` isolates TypeScript internal API access,
  such as private type IDs and shallow cycle placeholders.

### Type-Class Resolvers

All resolver pipeline modules live in `src/parsers/typeResolvers/`.

- `index.ts` is the ordered resolver registry. Resolver order is meaningful:
  syntax-first operators and specific shapes should appear before semantic
  fallbacks that would discard authored syntax.
- `arrayTypeResolver.ts` handles arrays and element-type recursion.
- `classTypeResolver.ts` handles class detection, constructor model assembly,
  constructor documentation, class members, static members, and class type
  parameters.
- `enumTypeResolver.ts` handles enum-like flags and enum symbol/member
  extraction.
- `functionTypeResolver.ts` handles callable type selection and function model
  assembly.
- `intrinsicTypeResolver.ts` handles all primitive/intrinsic flags such as
  `string`, `number`, `boolean`, `void`, `any`, `unknown`, `null`, and `never`.
- `intersectionTypeResolver.ts` handles intersection members and any merged
  callable/object shape TypeScript exposes for the intersection.
- `literalTypeResolver.ts` handles string/number/bigint/boolean literal nodes.
- `objectTypeResolver.ts` handles object-like types, object properties, index
  signatures, mapped-type index signatures, and object-keyword fallback.
- `tupleTypeResolver.ts` handles tuple element resolution and tuple arity.
- `typeOperatorTypeResolver.ts` preserves authored `keyof` syntax, resolves its
  operand and semantic result separately, and records whether that result is
  exact, a base constraint, or a fallback.
- `typeOperatorTypeNodes.ts` contains the shared syntax helpers used to find and
  propagate authored `keyof` nodes through parenthesized and nested type syntax.
- `unionTypeResolver.ts` owns union-specific behavior, including preserving
  authored union member order and overlapping type-operator members from
  `TypeNode`s.
- `specialTypeResolvers.ts` handles TypeScript-internal or context-sensitive
  shapes such as type parameters, conditional types, indexed access types, and
  substitution fallbacks.
- `externalTypeResolver.ts` contains the external-type policy used when
  `includeExternalTypes` is disabled.
- `signatureTypeParameterNodes.ts` is a shared helper for signature type
  parameter metadata used by class and function resolvers.
- `signatureParser.ts` owns shared function-like signature parsing: call
  signatures, parameters, parameter docs/defaults, and return types used by
  callable exports, constructors, and class methods.

A resolver should answer, "Does this `ts.Type` shape apply, and if so, which
model node should represent it?" It should keep pipeline concerns such as
ordering, fallback choice, and session recursion explicit. If it needs nested
type resolution, it should use the active resolver callback from the current
`TypeResolutionSession` instead of importing `resolveType` directly.

### Model Construction

- Classes in `src/models/types/` are model DTOs with rendering helpers such as
  `toString()`. They should not own parser policy. Compound constructors are the
  only exception: they delegate member normalization to `typeCanonicalizer` so
  all callers get the same union/intersection behavior from normal
  construction.
- `src/models/typeCanonicalizer.ts` owns compound member normalization such as
  flattening nested compounds, simplifying boolean literal unions, removing
  redundant `never`, keeping nullish members at the end, and deduplicating
  members. It exports the singleton `typeCanonicalizer`; the implementation
  class is internal so callers use one shared normalization policy.
- `src/models/typeEquivalence.ts` owns structural equivalence checks used by
  canonicalization, including the intentional rule that unaliased `any` can act
  as a wildcard when choosing between duplicate generated signatures. It exports
  the singleton `typeEquivalenceChecker`; the implementation class is internal.

### Shared Parser Helpers

- `common.ts` contains TypeScript name and type-argument helpers shared across
  parser layers.
- `documentationParser.ts` converts TypeScript documentation, JSDoc metadata, and
  parameter documentation into model documentation nodes.

## Requirements

- **Node.js**: >= 22

## License

This project is licensed under the terms of the [MIT license](/LICENSE).

## Acknowledgments

This project was started as a fork of [typescript-to-proptypes](https://github.com/merceyz/typescript-to-proptypes) created by [Kristoffer K.](https://github.com/merceyz).
