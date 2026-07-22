# Security Policy

## Supported Versions

<!-- security-support:start -->

| Installable release line                         | Status      | Maintenance policy                                                         |
| ------------------------------------------------ | ----------- | -------------------------------------------------------------------------- |
| `0.12.0-alpha.1` (`alpha` dist-tag)              | Supported   | Current linked alpha release. Security fixes ship in a new linked release. |
| Earlier prereleases                              | Unsupported | Upgrade to the current linked release; routine backports are not provided. |
| Unreleased `main` revisions and source snapshots | Best effort | Development revisions are not installable supported releases.              |

<!-- security-support:end -->

A2A Mesh is currently a pre-1.0 alpha project. Support applies only to the newest fully published,
linked prerelease exposed through the npm `alpha` dist-tag. All six public packages move together;
mixing package versions is outside the supported configuration.

A prerelease reaches end of support as soon as its successor is fully published, registry parity is
verified, and the `alpha` dist-tag advances. Security fixes normally ship forward in the next linked
release rather than as backports to historical alphas. The default branch, untagged commits, local
builds, and source snapshots receive best-effort development attention but are not supported
installable releases.

## Reporting a Vulnerability

Do not open a public issue, discussion, or pull request containing suspected exploit details,
credentials, private logs, or reproduction steps.

Use GitHub's
[private vulnerability reporting](https://github.com/oaslananka/a2amesh/security/advisories/new).
Include the affected package and version, deployment assumptions, impact, reproduction steps, and
any proposed mitigation. Remove real credentials, personal data, and unrelated secrets.

Use the following channels consistently:

- **Private vulnerability report:** suspected exploitable behavior or a security-boundary bypass.
- **Draft repository advisory:** maintainer coordination, private remediation, release preparation,
  and coordinated disclosure for a confirmed vulnerability.
- **Public issue:** non-sensitive hardening, defense-in-depth, documentation, or test improvements
  that do not reveal an unpatched vulnerability.
- **Ordinary security pull request:** routine dependency, tooling, policy, or hardening work with no
  confidential vulnerability context.

The current repository setting and governance evidence are recorded in the
[vulnerability reporting and review policy](https://github.com/oaslananka/a2amesh/blob/main/docs/governance/vulnerability-reporting-and-review-policy.md).

## Response Targets

These are operational targets for a solo-maintained alpha project, not contractual service-level
agreements. Active exploitation, credible credential exposure, or cross-tenant impact is handled as
an emergency and may change the sequence below.

| Stage                                  | Target                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Acknowledgement                        | Within 48 hours of a complete private report                            |
| Initial triage and severity assessment | Within 7 calendar days                                                  |
| Remediation target after triage        | Critical: 30 days; high: 60 days; medium or low: 90 days                |
| Coordinated publication                | After the patched installable release and upgrade guidance are verified |

If a target cannot be met, maintainers should update the reporter privately with the current risk,
blocker, mitigation, and next review date.

## Remediation and Disclosure Lifecycle

1. Reproduce and assess the report privately.
2. Create or update a draft repository security advisory for confirmed vulnerabilities.
3. Develop regression tests and a fail-closed fix without exposing private details.
4. Publish and verify the linked package release, provenance, registry parity, and prerelease
   dist-tag.
5. Publish the advisory with affected and patched version ranges plus practical upgrade guidance.
6. Request a CVE when a high-impact or broadly deployed vulnerability benefits from a globally
   recognized identifier. CVE assignment is not required to delay publication of an available fix.

The project may publish limited mitigation guidance before a fix when active exploitation or user
safety requires it. Otherwise, implementation and reproduction details remain private until a
patched release is installable.

## Security Upgrade Guidance

Before upgrading, review the current
[compatibility matrix](https://github.com/oaslananka/a2amesh/blob/main/docs/compatibility.md), the
[package changelogs](https://github.com/oaslananka/a2amesh/tree/main/packages), and the
[API stability policy](https://github.com/oaslananka/a2amesh/blob/main/docs/development/api-stability.md).
Release-integrity and provenance requirements are documented in the
[release integrity guide](https://github.com/oaslananka/a2amesh/blob/main/docs/release/release-integrity.md).
Breaking alpha changes and required application updates are documented under
[security upgrade guide](https://github.com/oaslananka/a2amesh/blob/main/docs/migrating/security-upgrades.md).
