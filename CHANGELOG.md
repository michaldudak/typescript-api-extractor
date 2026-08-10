# Changelog

## v1.0.0-beta.6

_August 10, 2026_

This release preserves authored `keyof` syntax in the output model and fixes three
React component extraction problems. Both change the emitted model, so read the
breaking changes below before upgrading.

### Breaking changes

- `TypeNode.kind` has two new discriminants: `typeOperator` and `typeQuery`. Authored `keyof` expressions are no longer expanded into their key union in place - they are preserved as a `TypeOperatorNode` carrying the authored operand (`type`), the checker result (`resolvedType`), and how that result was obtained (`resolutionKind`). A `typeof` operand becomes a `TypeQueryNode` with an `expressionName`. Nothing is lost from the model: `resolvedType` holds exactly what the previous release emitted in that position. The failure mode is silent, however - a formatter whose dispatch chain ends in a default return emits that default for every `keyof` in the API instead of throwing. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)

  To keep the previous output unchanged, format `resolvedType`:

  ```ts
  case 'typeOperator':
  	return node.resolvedType ? format(node.resolvedType) : `${node.operator} ${format(node.type)}`;
  case 'typeQuery':
  	return `typeof ${node.expressionName}`;
  ```

  The exported `TypeOperatorNode` class describes both output modes, so `resolvedType` is optional on it and a formatter typed against `TypeNode` needs the guard above. Output typed as `ResolvedModuleNode` - what default and literal `'resolved'` calls return - always carries the field, so `format(node.resolvedType)` alone typechecks there.

  To adopt the preserved syntax - which is what collapses, say, a 178-member `keyof React.JSX.IntrinsicElements` union into one readable line - format the operator itself:

  ```ts
  case 'typeOperator':
  	return `${node.operator} ${format(node.type)}`;
  ```

  `resolutionKind` tells you how far to trust `resolvedType`: `exact` is equivalent to the operator, `baseConstraint` is a still-generic operand's constraint rather than its eventual instantiated result (`keyof T` commonly resolves to `string | number | symbol` at extraction time), and `fallback` is a recoverable degradation. Every type node also implements `toString()`, so `String(node)` renders `keyof React.JSX.IntrinsicElements` without touching your switch at all.

- Some exports change their `kind` as a result of the React component detection fixes. An export whose type is a union of React-returning functions is now a `component` with one merged prop list instead of a `union`. Conversely, a capitalized function whose return type merely ends in `Element` - a local `ListElement`, or the DOM's `HTMLElement` - is now a `function` instead of a `component`, because return types are matched exactly against `Element`, `ReactElement`, and `ReactNode`. Under `includeExternalTypes: true`, exports that were `function` become `component`, since no component was detected in that mode at all before. If you branch on `ExportNode.type.kind`, review the `union` and `function` branches, and confirm nothing depended on a non-React `*Element` return type being classified as a component. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)

- Objects with more than 50 properties now report their properties instead of collapsing to an empty object when they sit at `propertyDepth` 0. Only the property-count limit is lifted there; the `depth <= 10` limit on the resolution stack is unchanged, so a shape reached through more than ten composition frames still collapses. Output grows accordingly for affected inputs; regenerate and review any snapshots. If you pass a `shouldResolveObject` that restates the old default, it keeps the old collapsing behavior, because an explicit return always wins over the default. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)

  Add the property-depth exemption to pick up the fix:

  ```ts
  shouldResolveObject: ({ propertyCount, depth, propertyDepth }) =>
  	(propertyDepth === 0 || propertyCount <= 50) && depth <= 10;
  ```

  Predicates that return `undefined` to defer to the default need no change, and a callback declared with only `name`, `propertyCount`, and `depth` still typechecks.

- Readonly arrays and tuples now serialize `isReadonly: true` and render as `readonly T[]` and `readonly [A, B]`. The field is omitted for mutable containers. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)

- `ParserContext` gained a required `propertyDepth: number` field. This is a type-level break only for code that constructs a `ParserContext` itself to drive parser internals; add `propertyDepth: 0`. `parseFile` and `parseFromProgram` callers are unaffected. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)

### New features

- Added the `typeOperatorOutput` parser option. Set it to `'syntaxOnly'` to omit `resolvedType` and `resolutionKind` from preserved operators, which avoids storing large key unions such as `keyof React.JSX.IntrinsicElements`. The default is `'resolved'`. Note that this is not an escape hatch from the migration above - it removes the resolved payload, so it requires the operator-formatting branch. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- `parseFile` and `parseFromProgram` now correlate their return type with the selected mode: `ResolvedModuleNode` for default and literal `'resolved'` calls, `SyntaxOnlyModuleNode` for literal `'syntaxOnly'` calls, and their union for a dynamic `ParserOptions` value. Both remain assignable to `ModuleNode`, so existing annotations keep typechecking. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- `shouldResolveObject` now also receives `propertyDepth`: how many property or index signature values were traversed to reach the object. It is 0 for the export's own type and for everything reached from it through composition alone - aliases, unions, intersections, and the parameter and return types of its call signatures - so the property-count limit can be applied only where unbounded expansion is the actual risk. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)

### Bug fixes

- `keyof` is now preserved through aliases, re-exports and barrels, generic substitutions, defaults and constraints, unions and intersections, conditional, mapped and indexed-access types, class and function members, and array and tuple containers. It is not reconstructed after TypeScript selector and inference utilities erase the authored syntax, so `ReturnType`, `Parameters`, `Awaited`, `ConstructorParameters`, `ThisParameterType`, and user-authored `infer` selectors still expose only their reduced semantic result. Fixes [#76](https://github.com/michaldudak/typescript-api-extractor/issues/76). [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- Large prop lists are no longer dropped. The default `propertyCount <= 50` rule applied at every depth, including the type a caller directly asked about, so a component with more than 50 props reported almost none of them and an exported alias over the same shape lost its properties entirely. On a DataGrid-shaped input the component goes from 1 prop to 55. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)
- Polymorphic components whose type is a union of function types, one arm per prop form, are now recognized as a single component with the arms' call signatures squashed into one prop list; props specific to a single arm come out optional. Unions with a non-component arm keep their union shape. On `@mui/x-data-grid@9.10.1` this moves 42 exports from `union` to `component`. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)
- React components are now detected under `includeExternalTypes: true`. Detection tested `instanceof ExternalTypeNode`, which describes how the parser chose to summarize React's types rather than the types themselves, so nothing matched once they were expanded and no export was recognized as a component. [#212](https://github.com/michaldudak/typescript-api-extractor/pull/212)
- Class getters are now reported as properties. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- Array types whose element is a function or a preserved operator now render with parentheses, so `(() => void)[]` no longer stringifies as `() => void[]`. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)

### Maintenance

- Restructured type resolution around syntax-first resolvers: authored alias replay (`authoredTypeAlias.ts`), shared generic bindings (`authoredTypeReferenceBindings.ts`, `typeParameterBindings.ts`), container identity helpers (`typeContainerUtils.ts`), and the parser context factory (`parserContextFactory.ts`) shared by production entry points and focused tests. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- Added a TypeScript 5.8 compatibility CI job. [#142](https://github.com/michaldudak/typescript-api-extractor/pull/142)
- Refreshed dev and CI dependencies, including `@types/react`, pnpm, Node, `tsx`, `typescript-eslint`, Vite, and GitHub Actions, and updated transitive dependencies to clear the `brace-expansion` and `esbuild` advisories. [#205](https://github.com/michaldudak/typescript-api-extractor/pull/205)-[#213](https://github.com/michaldudak/typescript-api-extractor/pull/213)

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
