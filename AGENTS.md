# Agent Notes

Read `README.md` before making parser or model changes. It contains the public
API, output shape, and the current architecture map; do not duplicate that
material here.

## Project Basics

- Use `pnpm`.
- Runtime target is Node.js `>=22`.
- Source lives under `src/`; fixture-based integration inputs live under
  `test/fixtures/`.
- Treat `dist/` as build output unless the user explicitly asks otherwise.

## Verification

Run the narrowest useful check while iterating, then broaden before finishing.

- `pnpm prettier`
- `pnpm typecheck`
- `pnpm typecheck:test-inputs`
- `pnpm lint`
- `pnpm test`

For parser behavior changes that intentionally alter fixture output, regenerate
expected JSON with:

```sh
pnpm test:regen
```

Review generated fixture diffs carefully; they are part of the behavior contract.

## Architecture Guardrails

- Keep export parsing, export normalization, and post-export transforms as
  separate concerns.
- Resolver order in `src/parsers/typeResolvers/index.ts` is observable. Place
  narrow resolvers before broad fallbacks.
- Type resolvers should use the active resolver callback from
  `TypeResolutionSession` for nested resolution rather than importing
  `resolveType` directly.
- Use `ScopedParserContext` helpers for temporary symbol/source scopes and
  type-parameter substitutions.
- Keep parser policy out of model DTOs. Shared compound normalization belongs in
  `src/models/typeCanonicalizer.ts`; structural equivalence belongs in
  `src/models/typeEquivalence.ts`.
- Preserve recoverable warning behavior and source-location quality when touching
  fallback or diagnostic paths.

## Testing Guidance

- Add focused tests near the changed parser, resolver, or model behavior.
- Prefer fixture tests for user-visible extraction output changes.
- Include regression coverage for TypeScript edge cases, especially aliases,
  re-exports, mapped types, conditional/indexed access types, React components,
  and generic substitutions.
- Avoid unrelated refactors while changing resolver behavior; small ordering
  changes can have broad output effects.
