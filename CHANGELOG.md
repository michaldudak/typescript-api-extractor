# Changelog

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
