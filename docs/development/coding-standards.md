# Coding standards

## TypeScript standards

- Keep public APIs explicit and documented.
- Prefer small modules with narrow responsibilities.
- Avoid implicit `any` and unsafe type escapes.
- Keep runtime validation at external boundaries.
- Keep security-sensitive defaults conservative.

## Formatting and linting

- Use the repository Prettier and ESLint configuration.
- Run `pnpm run lint` before opening a PR.
- Run `pnpm run format:check` when touching many files.

## Compatibility

- Treat protocol, CLI, and published package exports as compatibility-sensitive.
- Document breaking changes and route them through release notes.
- Prefer additive changes where practical.
