# Release integrity

## Goals

Release consumers should be able to verify what was built, from which commit, and by which release
process.

## Current release trust model

The npm release path is deliberately separated from ordinary CI:

- a maintainer manually dispatches `.github/workflows/publish.yml` from canonical `main`;
- the requested release tag and exact `PUBLISH <tag>` confirmation must match;
- the job is restricted to `oaslananka/a2amesh` and `refs/heads/main`;
- the `npm-publish` environment permits only `main` and requires a reviewer;
- npm authentication uses GitHub OIDC trusted publishing with job-scoped `id-token: write`;
- no `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or static npm environment secret is used;
- package sources, linked versions, tarballs, checksums, SBOM, and registry parity are validated;
- npm packages are published with provenance; and
- GitHub build-provenance attestations cover npm tarballs, `SHA256SUMS`, and the CycloneDX SBOM.

The environment currently allows self-review because the repository has one active maintainer. That
exception is governed by the documented emergency-bypass and retrospective policy and must be
removed when a second active maintainer is available.

## Credential evidence

The current repository secret and environment model is recorded in
[`github-actions-credentials.json`](github-actions-credentials.json) and explained in
[`secrets-management.md`](secrets-management.md). Repository validation rejects undocumented
workflow secret references, long-lived npm credentials, missing OIDC permissions, and stale
credential evidence.

## Verification steps

Before publishing:

1. run `pnpm run release:preflight`;
2. run `pnpm run release:artifacts` and `pnpm run release:validate`;
3. verify the canonical tag resolves to the intended commit;
4. inspect the `npm-publish` environment approval and branch policy;
5. confirm no static npm credential exists in repository or environment secrets; and
6. after publication, run `pnpm run release:parity` and verify npm provenance and GitHub
   attestations.

## Rotation and recovery

If the npm trust relationship is compromised, remove or replace the npm trusted-publisher entry,
block the `npm-publish` environment, review GitHub and npm audit logs, and follow the release recovery
ledger before another publish attempt. Static token fallback is prohibited.
