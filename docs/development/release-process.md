# Release process

## Release model

A2A Mesh uses semantic versioning and automated release preparation. Release automation should generate or update release notes and changelog content from conventional commits.

## Pre-release checks

Before publishing:

```bash
pnpm run release:dry-run
pnpm run release:ready
pnpm run pack:dry-run
pnpm run security
```

## Artifact integrity

Release artifacts should include:

- Package dry-run verification.
- Provenance where supported by the registry.
- Checksums or verification instructions for generated artifacts.
- Release notes that identify breaking changes, security fixes, and migration steps.

## Human-only actions

- Release credentials and registry permissions are not stored in docs.
- Maintainer should confirm package provenance and release assets after publication.
