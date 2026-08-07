# Changelog

## v1.0.0-beta.5

_August 6, 2026_

### Breaking changes

- `typescript` moved from `peerDependencies` to direct `dependencies`, so the extractor now always parses with the TypeScript version it ships with. This unblocks downstream projects using TSGo. If you pass a `Program` to `parseFromProgram`, create it with the newly exported `createProgram` so the program and the extractor share a single TypeScript instance. [#154](https://github.com/michaldudak/typescript-api-extractor/pull/154)

### New features

- Added `createProgram` (a re-export of TypeScript's `createProgram` from the bundled TypeScript version) along with the `CompilerOptions` and `Program` types to the public API. [#154](https://github.com/michaldudak/typescript-api-extractor/pull/154)

### Bug fixes

- Resolved TypeScript's built-in `Extract<T, U>` utility over index-like check types through the compiler's base constraint. `Extract<keyof T, string>` now resolves to `string` instead of the wider `string & (string | number | symbol)`. Fixes [#189](https://github.com/michaldudak/typescript-api-extractor/issues/189). [#190](https://github.com/michaldudak/typescript-api-extractor/pull/190)
- Fixed a crash when comparing generic alias arguments against their defaults for aliases whose resolved type exposes more type arguments than the alias declaration owns. Fixes [#143](https://github.com/michaldudak/typescript-api-extractor/issues/143). [#153](https://github.com/michaldudak/typescript-api-extractor/pull/153)
- `Documentation.getTagValue()` now returns the tag's value instead of its name. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)
- Non-literal parameter default values (object and array literals, identifiers, call expressions) are now reported as their authored source text instead of being dropped. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)
- Parameter documentation, defaults, and return types are now parsed the same way for functions, constructors, and class methods. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)
- `@private` and `@internal` now take precedence over `@public` when a JSDoc block contains several visibility tags. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)
- Recoverable parser warnings are now consistently routed through the `onWarning` handler. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)

### Maintenance

- Refactored the parser internals: type resolution is now a session-driven pipeline of ordered resolvers under `src/parsers/typeResolvers/`, exports are normalized into descriptors before `ExportNode` construction, React component handling moved into a post-export transform, and compound type normalization and structural equivalence moved into `typeCanonicalizer` and `typeEquivalence`. [#139](https://github.com/michaldudak/typescript-api-extractor/pull/139)
- Standardized golden test fixture names and inputs, and added the `typecheck:test-inputs` check to CI so invalid fixture inputs are caught before they land. [#140](https://github.com/michaldudak/typescript-api-extractor/pull/140)
- Added `AGENTS.md` and `CLAUDE.md` contributor guidance. [#141](https://github.com/michaldudak/typescript-api-extractor/pull/141)
- Refreshed runtime, dev, and CI dependencies, including `es-toolkit`, `@types/node`, `@types/react`, pnpm, Node, ESLint, Prettier, Vitest, Vite, `tsx`, `typescript-eslint`, and GitHub Actions. [#144](https://github.com/michaldudak/typescript-api-extractor/pull/144)-[#203](https://github.com/michaldudak/typescript-api-extractor/pull/203)

## v1.0.0-beta.4

_May 15, 2026_

### New features

- Added TypeScript 6 peer dependency support (`^5.8 || ^6.0`). [#134](https://github.com/michaldudak/typescript-api-extractor/pull/134)
- Added structured parser warnings through the new `onWarning` parser option, including source location, parsed symbol stack, warning code, and fallback details. Falls back to `console.warn` when no handler is provided. [#135](https://github.com/michaldudak/typescript-api-extractor/pull/135)

### Bug fixes

- Improved extraction of mapped object types with generic keys and values, including cases like `ReadonlyArray<{ [key in K]?: V }>` that previously collapsed to `{}`. [#112](https://github.com/michaldudak/typescript-api-extractor/pull/112)
- Improved handling of TypeScript `SubstitutionType` fallbacks so the extractor preserves representable base or constraint types instead of unnecessarily returning `any`. [#136](https://github.com/michaldudak/typescript-api-extractor/pull/136)
- Improved recoverable parser warning messages with better type text, source text, file/line/column context, and symbol stack information. Fixes [#81](https://github.com/michaldudak/typescript-api-extractor/issues/81). [#135](https://github.com/michaldudak/typescript-api-extractor/pull/135)

### Maintenance

- Refreshed runtime, dev, and CI dependencies, including `es-toolkit`, TypeScript, pnpm, ESLint, Vitest, Vite, `tsx`, `typescript-eslint`, GitHub Actions setup actions, and Node-related tooling. [#100](https://github.com/michaldudak/typescript-api-extractor/pull/100)-[#133](https://github.com/michaldudak/typescript-api-extractor/pull/133)
- Updated transitive dependencies in the lockfile. [#138](https://github.com/michaldudak/typescript-api-extractor/pull/138)
