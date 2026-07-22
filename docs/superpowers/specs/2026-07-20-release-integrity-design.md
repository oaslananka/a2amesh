# Release Integrity State Machine Design

**Issue:** #144
**Date:** 2026-07-20
**Status:** Approved for implementation

## Problem

A2A Mesh currently has four independently observable release states:

1. source versions in `.release-please-manifest.json` and public package manifests;
2. Release Please pull requests that prepare the next source version;
3. canonical Git tags used by the manual publish workflow;
4. npm package versions and dist-tags.

The repository source is on `0.11.0-alpha.1`, Release Please PR #156 proposes `0.12.0-alpha.1`, the newest canonical Git tag is `0.5.0-alpha.1`, and npm exposes `0.5.0-alpha.1` through `alpha` while older versions remain under `latest`. Existing checks validate internal source consistency, but they do not model or block cross-system drift.

The current `release-state.mjs` also treats any open Release Please PR as a publish blocker. That is incorrect when the open PR proposes a version newer than the checked-out, already-prepared version being published.

## Goals

- Preserve the protected, manually dispatched npm publishing workflow.
- Keep the release manifest as the source version authority for a checked-out release commit.
- Model source, Git, npm package, and npm dist-tag state explicitly.
- Prevent Release Please from preparing another version while the current source version is unpublished.
- Permit publication of a prepared version even when a newer Release Please PR is open, provided the target commit and version are internally consistent.
- Ensure prereleases advance only their prerelease dist-tag (`alpha`, `beta`, or `rc`); only stable releases may advance `latest`.
- Produce deterministic JSON and human-readable summaries suitable for local use and GitHub Actions.

## Non-goals

- Automatically publish packages after merging a release PR.
- Rewrite or republish historical npm versions.
- Automatically advance `latest` to any prerelease.
- Replace Release Please or introduce another versioning framework.
- Make GitHub Releases mandatory for npm publication.

## Authoritative Model

The release manifest and public package manifests define the **prepared source version** for a specific Git commit. They must remain identical across all linked public packages.

A release is **published** only when all of the following are true for the prepared source version:

- the canonical runtime tag `@a2amesh/runtime-v<version>` resolves to the checked-out commit;
- every configured public package exposes exactly that version on npm;
- the expected dist-tag points to that version (`latest` for stable versions; the first prerelease identifier for prereleases);
- prerelease publication does not change `latest`.

GitHub Release objects are evidence, not the version authority.

## State Classification

The state collector will return one of these mutually exclusive states:

### `published`

The prepared source version is fully represented by the canonical Git tag, every npm package, and the expected dist-tag.

### `release-pr-open`

The prepared source version is published and exactly one Release Please PR is preparing a newer linked version.

### `prepared-unpublished`

Source manifests agree, but the prepared version is missing its canonical Git tag, one or more npm package versions, or its expected dist-tag. This state blocks creation or update of the next Release Please PR, but is eligible for the protected publish process once a canonical tag points to the checked-out release commit.

### `partial-publication`

Only a subset of public packages or required dist-tags represents the prepared version. This state is a release incident and blocks both Release Please and further publication until reconciled.

### `superseded`

A committed recovery ledger explicitly rejects an unpublished and untagged prepared candidate in favor of a declared successor. The ledger entry records the exact historical release commit, successor version, decision date, public issue, and audit rationale. This state permits Release Please but permanently blocks Publish for the superseded version. Any later tag or npm evidence converts the condition to `drifted`.

### `drifted`

Internal source versions disagree, the canonical tag points to a different commit, an open release PR does not propose one linked version, or npm dist-tags violate stable/prerelease policy.

### `unavailable`

GitHub or npm state could not be read reliably. Network/API failures must never be treated as success.

## Components

### Pure release-state evaluator

A new module will accept normalized source, GitHub, Git, and npm observations and return the state, blockers, warnings, expected tag, expected dist-tag, and next safe action. It will not execute subprocesses or perform network requests.

This boundary allows deterministic unit tests for every state without contacting GitHub or npm.

### Observation adapters

`release-state.mjs` will remain the CLI entry point and gather:

- release configuration and manifest versions;
- local commit and canonical tag resolution;
- open Release Please PR metadata and the version proposed by each PR branch;
- npm package-version existence and dist-tags;
- the committed `.release-recovery.json` ledger, including Git ancestry and historical manifest validation.

Observation failures will be recorded and classified as `unavailable`.

### Workflow gates

The Release Please workflow will run the state collector before invoking Release Please:

- `published`, `release-pr-open`, and validated `superseded` states permit normal reconciliation of the release PR;
- `prepared-unpublished`, `partial-publication`, `drifted`, and `unavailable` block Release Please and publish an actionable summary.

The Publish workflow will evaluate the checked-out tag commit in publish mode:

- the target tag must match the prepared source version and checked-out commit;
- an open Release Please PR for a newer version is informational, not a blocker;
- partial npm publication is resumable only for missing packages of the same version;
- conflicting versions, tag commits, or dist-tag policy remain blockers;
- the current recovery ledger is staged before tag checkout, preventing historical tags from bypassing a later supersession decision.

### Dist-tag policy

`sync-npm-tags.mjs` will stop expecting `latest` for prereleases. For a prerelease it will validate only the prerelease tag and verify that `latest` is not moved to that prerelease. For a stable version it will validate `latest`.

The publish workflow already derives the publish tag from the prerelease identifier; the checks will enforce the same policy.

## Release Flow

1. Release Please opens one linked-version PR.
2. The PR is reviewed and merged, preparing a new source version.
3. The Release Please gate observes `prepared-unpublished` and does not create the next release PR.
4. A maintainer creates the canonical runtime tag on the release commit and dispatches Publish at that tag ref.
5. Publish validates artifacts and publishes missing packages idempotently.
6. Registry verification confirms every package and expected dist-tag.
7. The state becomes `published`.
8. Subsequent qualifying changes may create the next Release Please PR.

## Current Drift Recovery

The evidence review identified `a10452970f9db426f9ef6a407f8be2d69d10eec8` as the historical `0.11.0-alpha.1` release commit, with no canonical tag and no npm package publication. On July 22, 2026, issue #184 recorded that candidate as superseded by `0.12.0-alpha.1`.

The committed ledger allows PR #156 to be refreshed from the current default branch while preventing any later tag or publication of `0.11.0-alpha.1`. Partial publication is never eligible for supersession.

## Error Handling

- GitHub/npm command failures produce `unavailable`, never `published`.
- Missing individual npm packages produce `prepared-unpublished`; a mixed subset produces `partial-publication`.
- A canonical tag on the wrong commit produces `drifted`.
- An invalid supersession ledger, or tag/npm evidence for a superseded version, produces `drifted`.
- Multiple Release Please PRs or inconsistent proposed versions produce `drifted`.
- Human-readable output must never hide JSON blockers.

## Testing

Unit tests will cover at least:

- fully published stable and alpha releases;
- prepared source with no tag or npm versions;
- tag present but package publication absent;
- partial package publication;
- prerelease tag correct while `latest` points to an older stable version;
- prerelease incorrectly assigned to `latest`;
- canonical tag pointing to another commit;
- newer open Release Please PR while publishing the prepared version;
- multiple or internally inconsistent release PRs;
- GitHub/npm observation failure;
- valid supersession, invalid ledger history, later tag creation, and later npm evidence.

Static checks will verify that both workflows call the correct release-state modes and that prerelease dist-tag policy is consistent across scripts and workflow YAML.

## Acceptance Criteria Mapping

- One source version authority: manifest plus linked package equality checks.
- Deployment, container, and documentation alignment: existing source parity checks remain required and consume the prepared version.
- Release drift blocked: Release Please and Publish use explicit state modes.
- Prerelease transitions tested: state evaluator and dist-tag tests cover alpha/stable behavior.
- CI enforcement: release configuration validation requires both workflow gates.
- Recovery evidence: the CLI reports the exact tag, commit, missing npm packages, dist-tag status, and next safe command.
