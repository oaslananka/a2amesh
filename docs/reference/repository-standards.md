# Repository standards reference

## Status vocabulary

Every maturity criterion uses one of:

- `Passed`
- `Partial`
- `Missing`
- `Not applicable`
- `Needs human confirmation`

## Required local checks

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run docs:check`
- `pnpm run security`
- `pnpm run gc`

## Branch policy

- Do not push directly to `main`.
- Use PRs for all changes.
- Keep required checks green before merge.
- Keep mandatory review disabled until an independent reviewer exists.

## Release policy

- Use semantic versioning.
- Use release automation for changelog/release notes.
- Publish package provenance and artifact verification evidence where available.
