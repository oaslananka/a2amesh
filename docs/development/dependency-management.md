# Dependency management

## Package manager

Use pnpm and the checked-in lockfile. Do not switch package managers without an explicit architecture decision.

## Update policy

- Prefer small dependency PRs.
- Keep security updates prioritized.
- Run audit and dependency review checks.
- Avoid adding runtime dependencies for convenience-only utilities.
- Pin or constrain GitHub Actions to stable versions or SHAs where practical.

## Required checks

```bash
pnpm audit --audit-level high
pnpm run security
pnpm run check:packages
```

## Supply-chain review

For new dependencies, review:

- License compatibility.
- Maintenance activity.
- Transitive dependency weight.
- Security history.
- Runtime vs dev-only necessity.
