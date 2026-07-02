# Commit conventions

A2A Mesh uses Conventional Commits-style messages to support release automation and changelog generation.

## Format

```text
<type>(optional-scope): <summary>
```

## Common types

- `feat`: user-visible feature.
- `fix`: bug fix.
- `docs`: documentation only.
- `test`: test-only change.
- `refactor`: behavior-preserving code change.
- `chore`: repository, tooling, or maintenance change.
- `ci`: workflow or CI change.

## Breaking changes

Use `!` or a `BREAKING CHANGE:` footer and include migration guidance.

## Examples

```text
feat(runtime): add protocol compatibility check
fix(registry): preserve tenant scope in pagination
docs(security): document release integrity verification
```
