# Security Upgrades

A2A Mesh public packages move as one linked prerelease set. When a security fix is released, upgrade
all installed public packages to the same supported version.

## Upgrade from the alpha channel

```bash
pnpm add \
  @a2amesh/protocol@alpha \
  @a2amesh/runtime@alpha \
  @a2amesh/registry@alpha \
  @a2amesh/mcp@alpha \
  @a2amesh/cli@alpha \
  @a2amesh/create-a2amesh@alpha
```

Install only the packages your application uses, but do not mix A2A Mesh public package versions.
The current support window is defined in the repository
[security policy](https://github.com/oaslananka/a2amesh/blob/main/SECURITY.md).

## Validate the upgrade

1. Confirm every installed A2A Mesh package resolves to the supported linked release.
2. Review the [compatibility matrix](/guide/compatibility) and relevant package changelogs.
3. Re-run authentication, tenant-isolation, transport, and integration tests.
4. Verify every compound authentication scheme and declared scope is supplied.
5. Check package provenance and dist-tag parity with the
   [package verification guide](/release/package-verification).

Security releases may reject requests that older versions accepted with incomplete credentials.
Correct the client or authorization policy instead of weakening the new fail-closed behavior.

For detailed migration and emergency mitigation guidance, see the canonical
[security upgrade guide](https://github.com/oaslananka/a2amesh/blob/main/docs/migrating/security-upgrades.md).
