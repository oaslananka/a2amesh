# Coding standards

## TypeScript standards

- Keep public APIs explicit and documented.
- Prefer small modules with narrow responsibilities.
- Avoid implicit `any` and unsafe type escapes.
- Keep runtime validation at external boundaries.
- Keep security-sensitive defaults conservative.

## Module boundaries and complexity

Treat file size and complexity as review signals, not reasons to introduce generic indirection.
A module should have one primary reason to change and a boundary that can be tested directly.

- Keep transport entrypoints focused on protocol or framework wiring. Delegate cohesive domain behavior to resource-specific modules, while keeping validation and authorization beside the operation they protect.
- Separate persistence concerns when they change independently: records/codecs, queries, migrations, indexing, retention, audit, and transaction orchestration should not accumulate in one storage module.
- Keep UI application shells responsible for data hooks, top-level state, navigation, and composition. Move screen rendering, reusable operator components, and pure filtering or presentation models into focused modules.
- Keep generated schema or OpenAPI data separate from hand-maintained document composition and verify the generated contract after refactors.
- Consolidate clone groups only when the shared abstraction has stable domain meaning. Prefer readable domain-specific code when sharing would hide policy, authorization, or lifecycle differences.
- Treat 500 non-generated lines as a review threshold. A file may exceed it for cohesive declarative data, generated content, or another documented reason; otherwise split it before adding another responsibility.
- Keep functions within the configured Sonar cognitive-complexity limit, currently 15. Extract named decision or orchestration steps instead of suppressing the finding.
- Avoid circular imports and new cross-workspace dependency cycles. Depend through existing public package surfaces unless an internal same-package boundary is intentional.

A pull request that crosses one of these thresholds should include before/after size or complexity evidence, focused boundary tests, and an explanation when the code intentionally remains above the threshold.
Public API, package exports, generated schemas, and wire behavior must remain unchanged unless the change is explicitly versioned.

## Formatting and linting

- Use the repository Prettier and ESLint configuration.
- Run `pnpm run lint` before opening a PR.
- Run `pnpm run format:check` when touching many files.

## Compatibility

- Treat protocol, CLI, and published package exports as compatibility-sensitive.
- Document breaking changes and route them through release notes.
- Prefer additive changes where practical.
