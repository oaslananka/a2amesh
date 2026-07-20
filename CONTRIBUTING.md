# Contributing

Thanks for helping improve A2A Mesh.

## Local workflow

1. Use Node `24.16.0` and pnpm `11.7.0` by default (`.node-version`, `.nvmrc`, and `packageManager` are the source of truth).
2. Install dependencies with `pnpm run setup`.
3. Run focused tests while iterating.
4. Run `pnpm run ui:install:browsers` once per machine before the full UI smoke path.
5. Run `pnpm run verify` before opening a PR.

## Legal authority and Developer Certificate of Origin

By contributing non-trivial code, documentation, tests, examples, workflows, or other project assets, contributors certify that they have the legal right to submit the contribution under the project license. A2A Mesh uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) as the lightweight legal mechanism for this assertion.

Every non-trivial commit SHOULD include a DCO sign-off line:

```text
Signed-off-by: Your Name <your.email@example.com>
```

The usual way to add this line is:

```bash
git commit -s
```

PowerShell:

```powershell
git commit -s
```

Pull requests that contain non-trivial contributions may be asked to add or repair sign-offs before merge.

## Pull requests

1. Open PRs against `main` on the public collaboration surface in use.
2. Ensure you follow the [issue taxonomy](./docs/development/issue-taxonomy.md) and apply appropriate labels.
3. Add tests for every public behavior change.
4. Add or update docs when user-facing behavior changes.
5. Use Conventional Commit messages so release-please can derive versions.
6. Keep PRs focused and release-note friendly.

## Coding standards and tests

Contributions must follow the repository coding standards, commit conventions, and test policy:

- [Coding standards](./docs/development/coding-standards.md)
- [Testing policy](./docs/development/testing-policy.md)
- [Commit conventions](./docs/development/commit-conventions.md)

Major new behavior must include automated tests unless the PR explains why tests are not applicable. User-facing behavior changes must update documentation.

## CI and releases

Local git hooks are intentionally tiered:

- `pre-commit`: staged formatting + staged lint only
- `pre-push`: `pnpm run verify`

To verify your change before submitting a PR, run the full check suite:

```bash
pnpm install --frozen-lockfile
pnpm run ui:install:browsers
pnpm run verify
```

PowerShell:

```powershell
pnpm install --frozen-lockfile
pnpm run ui:install:browsers
pnpm run verify
```

Releases are cut by release-please manifest mode after changes merge to `main`.
Version numbers are derived from Conventional Commit history and the
`.release-please-manifest.json` state.

Maintainers can validate the release configuration with:

```bash
pnpm run release:dry-run
```

PowerShell:

```powershell
pnpm run release:dry-run
```

Detailed local setup guidance lives in [docs/development/setup.md](./docs/development/setup.md).
