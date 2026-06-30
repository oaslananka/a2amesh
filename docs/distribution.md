# Distribution

npm is the primary distribution channel for all A2A Mesh packages. JSR and Homebrew
are secondary channels with limited scope.

## npm (primary)

All approved packages are prepared for first publication to the npm registry
under the `@a2amesh` scope, including the `@a2amesh/create-a2amesh` scaffolder.
npm publication has not happened yet and requires explicit future approval.

| Package         | npm name                  |
| --------------- | ------------------------- |
| Protocol types  | `@a2amesh/protocol`       |
| Core runtime    | `@a2amesh/runtime`        |
| Registry server | `@a2amesh/registry`       |
| MCP bridge      | `@a2amesh/mcp`            |
| CLI             | `@a2amesh/cli`            |
| Scaffolder      | `@a2amesh/create-a2amesh` |

Install:

```bash
pnpm add @a2amesh/runtime
```

See [Install](install.md) for detailed requirements.

### Provenance

Plan: npm packages will be published with [provenance](https://docs.npmjs.com/generating-provenance-statements)
via [npm Trusted Publishing / OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect).
Each published package will include a signed attestation linking the package to the
GitHub Actions workflow and commit that produced it.

### Version skew policy

- All `@a2amesh/*` packages within a release share the same version number.
- `@a2amesh/create-a2amesh` participates in the linked public release train.
- Forward compatibility: a newer minor version of the core runtime can work with
  an older minor version of an adapter. Breaking changes are signalled by a
  major version bump across the entire `@a2amesh/*` scope.

### Planned publication surface by ecosystem

| Ecosystem | Packages approved for first publication | Publishing method                                        |
| --------- | --------------------------------------- | -------------------------------------------------------- |
| npm       | Approved public `@a2amesh/*` packages   | `publish.yml` via npm OIDC/Trusted Publishing (planned)  |
| JSR       | None yet                                | Manual `npx jsr publish` (requires JSR token in secrets) |
| Homebrew  | None yet                                | Manual formula update in `a2amesh/homebrew-tap`          |

## JSR (limited scope)

[JSR](https://jsr.io) is a secondary channel for portable ESM surfaces only.

### Eligible packages

| Package                    | JSR eligible | Reason                                   |
| -------------------------- | ------------ | ---------------------------------------- |
| `@a2amesh/protocol`        | ✅           | Pure TypeScript types, zero runtime deps |
| `@a2amesh/protocol`        | ✅           | Portable JSON Schema definitions         |
| `@a2amesh/protocol/client` | ✅           | Standalone ESM client surface            |
| All other packages         | ❌           | Require Node.js built-ins or Express     |

### Constraints

- Do NOT publish packages that depend on Node.js built-ins (`node:http`, `node:fs`,
  `node:net`), Express, or any transport to JSR — they are not portable.
- JSR packages must have zero or portable-only runtime dependencies.
- JSR does NOT replace npm. npm remains the authoritative distribution channel.

### JSR package metadata mapping

Each eligible `@a2amesh` npm package maps to a JSR package under the `@a2amesh`
scope. The JSR name should match the npm name without the `@a2amesh/` prefix and
with `/` replaced by `-` for subpath exports.

| npm package                | JSR scope/name      |
| -------------------------- | ------------------- |
| `@a2amesh/protocol`        | `@a2amesh/protocol` |
| `@a2amesh/protocol/client` | `@a2amesh/protocol` |
| `@a2amesh/protocol`        | `@a2amesh/protocol` |

JSR `exports` must mirror the `"exports"` field in `package.json` minus
Node.js-only paths.

### Dry-run before first JSR publish

```bash
# From the package directory, after a clean build:
npx jsr publish --dry-run

# Verify the displayed export list includes only portable ESM surfaces.
# If the dry-run includes node:builtin imports, do NOT publish to JSR.
```

### JSR release checklist

```text
1. Verify the package exports only portable ESM surfaces.
2. Run npx jsr publish --dry-run to validate metadata.
3. Confirm the JSR package entry matches the npm entry point.
4. Publish with npx jsr publish (requires JSR token).
5. Verify the JSR page resolves and the code is readable.
```

## Homebrew (limited scope)

[Homebrew](https://brew.sh) is a secondary channel for the `a2amesh` CLI only.

### Formula

The Homebrew tap formula installs the released CLI tarball from GitHub Releases
and verifies the SHA-256 checksum.

Formula location: `a2amesh/homebrew-tap/Formula/a2amesh.rb` (external repository)

### CLI naming rules

- The formula name is `a2amesh` (not `@a2amesh/cli`).
- The installed binary is `a2amesh`.
- The formula `desc` field must match the CLI `package.json` `description`.
- The formula `homepage` must point to `https://github.com/oaslananka/a2amesh`.
- The formula `version` must match the CLI `package.json` `version`.
- The `sha256` checksum is computed from the release tarball attached to the
  GitHub Release by the publish workflow.
- The `url` points to the GitHub Release tarball:
  `https://github.com/oaslananka/a2amesh/archive/refs/tags/v<version>.tar.gz`

### Homebrew release checklist

```text
1. Confirm the CLI tarball is attached to the GitHub Release with a SHA-256 checksum.
2. Update the formula in a2amesh/homebrew-tap with the new version and checksum.
3. Test with brew install a2amesh on macOS and Linux.
4. Verify brew upgrade a2amesh works from the previous version.
```

### Constraints

- Only the CLI package (`@a2amesh/cli`) is distributed via Homebrew.
  Runtime libraries, adapters, and transports are npm-only.
- Homebrew updates are not release-blocking before v1.1. They are best-effort
  secondary distribution.

## Release and tag mapping

| Action                      | Tag format        | Triggered by             | Produces               |
| --------------------------- | ----------------- | ------------------------ | ---------------------- |
| Release Please version bump | (PR only, no tag) | Merge to main            | Updated `package.json` |
| GitHub Release              | `v<version>`      | Maintainer action        | Release notes and tag  |
| npm publish                 | (release tag)     | Owner workflow dispatch  | npm packages           |
| JSR publish                 | (same git tag)    | Manual after npm publish | JSR packages           |
| Homebrew formula update     | (same git tag)    | Manual after release     | `homebrew-tap` update  |

All `@a2amesh/*` packages within the same release share the same `v<version>` tag.
`@a2amesh/create-a2amesh` uses the linked public release train and the canonical `@a2amesh/runtime-v<version>` publish tag.

## GitHub environments and secrets

### Environments

| Environment   | Used by                                | Protection rules  |
| ------------- | -------------------------------------- | ----------------- |
| `npm-publish` | `publish.yml` — OIDC to npm            | Required reviewer |
| `jsr-publish` | Manual JSR publish (not yet automated) | None (future)     |

### Secrets required

| Secret name          | Scope       | Used by            | Description                       |
| -------------------- | ----------- | ------------------ | --------------------------------- |
| `JSR_TOKEN` (future) | repo secret | Manual JSR publish | JSR API token (future automation) |

npm publishing uses GitHub OIDC through npm Trusted Publishing. The workflow does
not load a registry token.

### Dry-run strategy

Before any live publish:

1. **npm**: Run `scripts/check-npm-pack.mjs` (`pnpm run pack:dry-run`). This
   builds all packages, runs `npm pack --dry-run`, validates that each tarball
   is installable in a clean temp project.
2. **JSR**: Run `npx jsr publish --dry-run` from each eligible package directory.
   Review the export list and dependency list for Node.js built-in leaks.
3. **Homebrew**: Manually test `brew install` from a local formula file pointing
   to the release tarball URL. Verify `a2amesh --version` matches.

### Rollback

| Channel  | Rollback method                                           |
| -------- | --------------------------------------------------------- |
| npm      | `npm unpublish <pkg>@<version>` (within 72h) or deprecate |
| JSR      | No rollback. Deprecate with `jsr publish --deprecate`     |
| Homebrew | Revert formula commit and push. Publish a patch bump.     |

Rollback is a last resort. Prefer a forward fix by bumping the patch version
and publishing a correction.

### Publishing is NOT enabled in this repository's normal CI

- PR CI (`ci.yml`) does NOT publish to any registry.
- `release-please.yml` creates release PRs and updates changelogs only.
- `publish.yml` is an owner-triggered workflow with manual confirmation required.
- No npm, JSR, or Homebrew publish occurs on merge to main.
- No registry tokens are loaded during normal CI runs.

See [Release Process](release/process.md) for the full workflow.

## Non-goals (out of scope)

- Publishing to a private registry (npm Enterprise, Verdaccio).
- Container image distributions (Docker, GitHub Container Registry).
- OS-specific packages (Deb, RPM, Chocolatey, Winget).
- Cloud marketplace distributions (AWS, GCP, or vendor-specific marketplaces).
- Package mirroring or CDN publication (UNPKG, esm.sh, Skypack).

These may be added in future milestones but are not part of the current
distribution plan.

## Checklist before enabling each channel

### npm (prepared, not yet published)

- [x] OIDC provider configured in GitHub org
- [x] npm Trusted Publishing enabled on `@a2amesh` scope
- [x] `publish.yml` workflow exists and is owner-triggered
- [x] Package manifests have correct `publishConfig`
- [x] Provenance attestations verified on test publish

### JSR (not yet enabled)

- [ ] JSR account created under `@a2amesh` scope
- [ ] JSR token added as repo secret `JSR_TOKEN`
- [ ] `jsr.json` or `jsr.jsonc` config added to eligible packages
- [ ] Dry-run passed: no Node.js built-in leaks
- [ ] First manual publish verified

### Homebrew (not yet enabled)

- [ ] `a2amesh/homebrew-tap` repository created
- [ ] Formula template created for `a2amesh`
- [ ] Release tarball SHA-256 checksum pipeline verified
- [ ] Manual `brew install` test passed on macOS and Linux
- [ ] `brew upgrade` test passed
