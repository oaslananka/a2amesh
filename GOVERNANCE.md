# Governance

## Roles

- **Maintainer**: @oaslananka — final decisions on direction, releases and security.
- **Contributor**: Anyone with a merged pull request.
- **Adapter Champion**: Responsible for the quality and roadmap of a specific adapter.

## Decision Making

Significant changes such as breaking API changes, new packages or architectural shifts should be proposed as an RFC in GitHub Discussions under Ideas.

- Consensus period: 7 days
- Final decision: maintainer

## Release Process

1. release-please derives release pull requests from Conventional Commits merged to `main`.
2. Contributors verify changes locally with `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `pnpm run test`.
3. Merging a release pull request updates version manifests and changelogs on `main`.
4. Owner dispatches the publish workflow with explicit confirmation to create npm packages, attestations, and registry publication.
5. GitHub Actions is the supported CI/CD system for validation, release, publishing, security scanning, and artifact preparation.

## Continuity and access recovery

The project treats continuity as a release and security requirement. To satisfy OpenSSF Silver continuity expectations, the repository should maintain at least two trusted people who can perform the following actions within one week if any one person becomes unavailable:

- triage and close issues;
- review and merge pull requests;
- dispatch release and security workflows;
- rotate compromised credentials;
- publish or pause npm releases;
- update security advisories and vulnerability-reporting instructions.

Current status: the repository is still recruiting an independent maintainer before enabling mandatory multi-person review and full continuity. The active tracking issue is [#69](https://github.com/oaslananka/a2amesh/issues/69). Until that is complete, continuity is documented as an explicit governance gap rather than being overstated.

## Review and release authority

Normal changes are proposed through pull requests against `main`. Branch protection requires CI, docs, security, CodeQL, Scorecard, and conversation-resolution gates before merging. Release publication is a separate maintainer-controlled step and must not be treated as automatic after a version bump.

Release authority is intentionally separated into:

1. release preparation by Release Please;
2. CI/security verification on the release PR;
3. maintainer review and merge;
4. explicit workflow dispatch for npm publication and provenance evidence.
