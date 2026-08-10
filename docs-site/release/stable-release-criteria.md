# Stable Release Criteria

A2A Mesh remains on the alpha channel until every criterion in this document is satisfied on the exact reviewed release commit. A passing alpha release is not automatically a stable release candidate.

## Machine-readable gate

Run the normal release checks for the current prerelease line:

```bash
pnpm run release:ready
```

```powershell
pnpm run release:ready
```

Evaluate the additional stable-release contract with:

```bash
pnpm run release:stable-ready
```

```powershell
pnpm run release:stable-ready
```

`release:stable-ready` runs the pre-publish `a2amesh release-check` workflow and adds a fail-closed public-surface gate. It exits non-zero while any linked public package has a prerelease version or an export/binary inventory that is not marked `stable`. Because the candidate version must not exist on npm before publication, this pre-publish mode defers registry/dist-tag parity to the protected publish workflow and the explicit `pnpm run release:parity` post-publish check.

## Required criteria

A stable candidate must satisfy all of the following:

1. **One linked stable version.** All six public packages and `.release-please-manifest.json` use the same stable SemVer version without an `alpha`, `beta`, or `rc` identifier.
2. **Explicit public surfaces.** Every published package has a reviewed `public-surface.json` inventory. Export keys and executable names match `package.json`, and every inventory status is `stable`.
3. **Compatibility contract.** The official A2A v1.0 profile remains the default, legacy behavior remains documented, and experimental profiles stay opt-in.
4. **Migration evidence.** Every breaking or potentially breaking API, CLI, registry, MCP, configuration, or environment-variable change includes migration guidance and a versioning decision.
5. **Release verification.** Required CI, security scanning, CodeQL, documentation, package dry-runs, conformance, examples, containers, and deployment chart lifecycle checks succeed on the reviewed commit.
6. **Supply-chain evidence.** The protected publish path produces reviewed tarballs, SHA-256 checksums, a CycloneDX SBOM, GitHub artifact attestations, and npm provenance through Trusted Publishing/OIDC.
7. **Post-publish parity.** After publication, all linked packages are visible under the expected version, `latest` points to the stable release, component tags resolve to the canonical release commit, and `pnpm run release:parity` succeeds. This criterion is intentionally verified after publish rather than by the pre-publish stable-candidate gate.
8. **Experimental boundaries.** Internal Fleet, provider-worker, adapter, and transport packages remain private unless they receive a separate public API review and release decision.

## Public surface inventories

Each published package keeps `packages/<name>/public-surface.json` with this contract:

```json
{
  "status": "alpha",
  "exports": ["."],
  "bins": []
}
```

- `status` must match the package version channel: `alpha`, `beta`, `rc`, or `stable`.
- `exports` lists every public `package.json` export key.
- `bins` lists every installed executable name.
- Additive and breaking surface changes require an explicit inventory change in the same pull request.

The current checker is:

```bash
node scripts/check-public-surface.mjs
node scripts/check-public-surface.mjs --target=stable
```

```powershell
node scripts/check-public-surface.mjs
node scripts/check-public-surface.mjs --target=stable
```

## Release decision

A stable release is a separate maintainer decision after the gate passes. Do not remove prerelease identifiers, change inventories to `stable`, create a stable tag, or advance npm `latest` merely to make the gate pass. Resolve the underlying compatibility, documentation, verification, and release-evidence requirements first.

After those requirements pass, record the current npm dist-tags and dispatch the protected publish workflow with the exact `PUBLISH STABLE <tag>` confirmation. The ordinary `PUBLISH <tag>` confirmation is reserved for prereleases and cannot authorize a stable `latest` promotion.
