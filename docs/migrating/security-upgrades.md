# Security Upgrade Guide

A2A Mesh public packages use linked release versions. When a security fix is released, upgrade
all six public packages to the same supported version rather than updating only the package named
in an advisory.

## Supported release

The current supported installable release is listed in [`SECURITY.md`](../../SECURITY.md). During
the pre-1.0 lifecycle, support applies to the newest fully published linked stable release exposed
through the npm `latest` dist-tag. Historical prereleases are unsupported once a stable successor
is published and registry parity is verified.

## Upgrade the linked package set

For an existing pnpm project, update every A2A Mesh public package together:

```bash
pnpm add \
  @a2amesh/protocol \
  @a2amesh/runtime \
  @a2amesh/registry \
  @a2amesh/mcp \
  @a2amesh/cli \
  @a2amesh/create-a2amesh
```

For npm projects:

```bash
npm install \
  @a2amesh/protocol \
  @a2amesh/runtime \
  @a2amesh/registry \
  @a2amesh/mcp \
  @a2amesh/cli \
  @a2amesh/create-a2amesh
```

Install only the packages the application uses, but keep all installed A2A Mesh public packages on
the same version. Do not mix historical prerelease versions with the current release.

## Validate the upgrade

1. Confirm the resolved package versions match the supported release in `SECURITY.md`.
2. Review the relevant package changelogs, especially
   [`@a2amesh/runtime`](../../packages/runtime/CHANGELOG.md).
3. Review the [compatibility matrix](../compatibility.md) and
   [API stability policy](../development/api-stability.md).
4. Re-run the application's authentication, tenant-isolation, transport, and integration tests.
5. Verify deployment configuration still supplies every required credential and scope.
6. Confirm the installed package provenance and dist-tag using the
   [package verification guide](../release/package-verification.md).

## Authentication policy changes

Security releases may tighten fail-closed behavior. After upgrading, verify compound security
requirements explicitly:

- separate requirement objects remain alternatives;
- every scheme in one requirement must succeed;
- every declared scope must be present;
- compound credentials must resolve to the same principal and tenant;
- clients do not depend on internal authentication failure details.

A request rejected after an upgrade may indicate that the previous version accepted an incomplete
credential set. Correct the client or authorization configuration rather than weakening the policy.

## Emergency mitigation

When an immediate upgrade is not possible, apply the workaround from the published advisory in a
trusted upstream authorization layer. Enforce all required credentials, scopes, principal identity,
and tenant identity before requests reach A2A Mesh. Treat that as a temporary mitigation and plan
the linked package upgrade.

## Reporting upgrade regressions

Use a public issue for non-sensitive compatibility or documentation regressions. Use GitHub private
vulnerability reporting when a regression may expose an unpatched security-boundary bypass. Never
include credentials, private logs, or exploit details in a public issue.
