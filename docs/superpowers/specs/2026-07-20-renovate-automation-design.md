# Renovate Automation Design

**Issue:** #165
**Date:** 2026-07-20
**Status:** Approved by implementation instruction

## Problem

`renovate.json` exists but Renovate has never created a Dependency Dashboard or pull request. The file references repository labels that do not exist and there is no repository-owned runner or validation gate. A2A Mesh also contains version pins outside ordinary package manifests, including workflow tool versions and runtime manifests.

## Goals

- Run Renovate without a paid service or broad long-lived token.
- Use a SHA-pinned official GitHub Action and the least-privilege repository token.
- Preserve linked `@a2amesh/*` package ownership and release integrity.
- Keep major and breaking upgrades human-approved.
- Keep GitHub Actions and container dependencies pinned.
- Validate configuration and repository labels before merge.
- Make update cadence predictable for Europe/Istanbul.

## Non-goals

- Automerge dependency pull requests.
- Allow Renovate to publish packages or modify release tags.
- Use existing broad PAT secrets solely to bypass GitHub workflow approval behavior.
- Run arbitrary post-upgrade commands with Docker socket access.

## Architecture

A scheduled/manual `.github/workflows/renovate.yml` invokes `renovatebot/github-action` at a full commit SHA with `github.token`. A global repository-managed config disables onboarding, targets only `oaslananka/a2amesh`, and uses an isolated `repository-managed-renovate/` branch prefix. Repository policy remains in `renovate.json`.

A local Node validator checks the project-specific contract: valid labels, internal package exclusion, no automerge, pinned managers, bounded concurrency, release-age policy, and workflow permissions. CI also invokes Renovate's official strict validator using an exact Renovate package version.

## Dependency Policy

- Internal `@a2amesh/*` packages stay disabled.
- Major updates require Dependency Dashboard approval.
- Minor and patch updates remain review-required.
- npm releases wait at least three days with strict internal checks.
- Vulnerability alerts remain enabled and are not schedule-delayed.
- GitHub Actions and container references remain pinned.
- Lockfile maintenance runs monthly in the normal maintenance window.
- Renovate updates are limited to three per hour and six concurrently.

## Authentication and CI Behavior

The repository `GITHUB_TOKEN` has write permissions and can create issues and pull requests. GitHub may place workflow runs from automation-created pull requests into approval-required state. This is accepted instead of using a broad PAT. A future least-privilege GitHub App installation token can replace it without changing repository policy.

## Testing

Tests verify the workflow's permissions, action SHA, repository allowlist, repository-managed settings, labels, internal package exclusion, update policy, and validator script integration. The official `renovate-config-validator --strict` command provides schema and semantic validation.
