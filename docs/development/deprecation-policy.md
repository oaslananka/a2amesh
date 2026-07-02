# Deprecation policy

## Principles

- Deprecations should be explicit, documented, and test-backed.
- Users should receive migration guidance before removal.
- Removals should not be hidden inside unrelated refactors.

## Process

1. Document the deprecated API, CLI flag, configuration key, or behavior.
2. Add a migration path.
3. Add or update tests that preserve transition behavior.
4. Mention the deprecation in release notes.
5. Remove only in a later release after the migration window.

## Pre-1.0 note

The project is pre-1.0, but compatibility still matters for active users. Pre-1.0 does not justify silent breaking changes.
