# How to contribute a change

## 1. Choose the right change type

- Bug fix: include a regression test when practical.
- Feature: open an issue first if it changes public behavior.
- Documentation: keep examples aligned with package scripts.
- Security: follow `SECURITY.md`; do not open public vulnerability details before coordinated disclosure.

## 2. Work locally

Run the narrowest relevant checks first, then the broader gate:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run docs:check
```

## 3. Open a PR

Use the PR template. Include:

- Summary.
- Risk level.
- Tests run.
- Behavioral compatibility notes.
- Follow-up issues for risky changes not included.

## 4. Review expectations

This is currently a solo-maintainer repository. Human review should become mandatory only after an independent reviewer exists. Bot feedback does not count as human review.
