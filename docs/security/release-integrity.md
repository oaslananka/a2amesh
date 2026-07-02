# Release integrity

## Goals

Release consumers should be able to verify what was built, from which commit, and by which release process.

## Current expectations

- Release preparation runs package dry-run checks.
- Security checks run before release.
- Published packages should use registry-supported provenance where configured.
- Release notes should identify package versions and migration risk.

## Follow-up work

- Publish SBOMs for release artifacts.
- Publish checksum files for generated artifacts where applicable.
- Document verification steps for npm provenance and GitHub attestations.
- Add release integrity evidence to `docs/openssf-evidence.md` after the first verified release.
