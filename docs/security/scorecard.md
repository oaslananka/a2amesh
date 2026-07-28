# OpenSSF Scorecard

Scorecard is a public signal, not a maturity claim. The repository records dated detector output,
compares it with live GitHub and release evidence, and assigns an owner and exit condition to every
below-10 or unavailable check.

## Current observation

- Observed: **2026-07-28T00:27:40Z**
- Score: **7.1**
- Scorecard: `v5.3.0` (`c22063e786c11f9dd714d777a687ff7c4599b600`)
- Evidence owner: `@oaslananka`

| Check                | Detector result                                      | Verified evidence and disposition                                                                                                                                                                                                                                             | Owner / exit condition                                                                                                                                                 |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Code-Review`        | 1; 3 of 27 changesets had an approval.               | Accepted solo-maintainer limitation. Pull-request-only changes, required CI/security/CodeQL, linear history, and verified squash merges are compensating controls; they are not represented as independent review.                                                            | `@oaslananka`; recruit an independent active maintainer, then require one non-author approval, code-owner review, stale-review dismissal, and last-push approval.      |
| `Maintained`         | 0; repository created within the last 90 days.       | Time-based detector rule; current commits, releases, issues, and green CI cannot change this score early.                                                                                                                                                                     | `@oaslananka`; re-evaluate after **2026-09-26**.                                                                                                                       |
| `CII-Best-Practices` | 5; Passing badge detected.                           | OpenSSF Best Practices project `13402` achieved Passing on 2026-07-03. Silver remains a separate future target and is not claimed.                                                                                                                                            | `@oaslananka`; keep BadgeApp evidence current and pursue Silver only after its human/governance criteria are met.                                                      |
| `Signed-Releases`    | 0; detector reported no signed/provenance release.   | Verified detector gap. `0.14.0-alpha.1` contains six checksum-verified tarballs, a CycloneDX SBOM, npm SLSA provenance for all six packages, and GitHub SLSA attestations for release assets.                                                                                 | `@oaslananka`; retain release evidence and re-check future Scorecard versions. Do not weaken or duplicate the existing provenance path merely to satisfy the detector. |
| `Branch-Protection`  | -1; detector authentication/internal error.          | Live GitHub API evidence on 2026-07-28 shows classic `main` protection with 15 required checks, strict updates, admin enforcement, and blocked force-push/deletion. `.github/rulesets/main.json` remains desired state, not a claim that a ruleset is active.                 | `@oaslananka`; refresh the API evidence every 90 days and re-run when Scorecard can read classic protection.                                                           |
| `Contributors`       | 0; no contributing companies or organizations.       | Accurate ecosystem limitation for a new solo-maintained project. No organization diversity is fabricated.                                                                                                                                                                     | `@oaslananka`; improve only through genuine independent participation and review the contributor/maintainer roster during the quarterly governance review.             |
| `CI-Tests`           | 0; detector reported no tested merged pull requests. | Verified detector false negative. Pull requests and merge-queue entries run unit, integration, recovery, conformance, compatibility, consumer, UI, mutation, package, performance, schema, and surface checks. `CI / tests-required` and `CI / required-summary` fail closed. | `@oaslananka`; keep the stable required contexts and re-run Scorecard after detector updates.                                                                          |

Checks scoring 10 at this observation were `Dangerous-Workflow`, `Dependency-Update-Tool`,
`Token-Permissions`, `Security-Policy`, `Binary-Artifacts`, `Pinned-Dependencies`,
`Vulnerabilities`, `SAST`, `Packaging`, `Fuzzing`, and `License`.

## Required CI evidence

Pull requests and merge-queue entries expose two fail-closed summaries. `CI / tests-required`
provides detector-friendly unit, integration, recovery, and conformance evidence.
`CI / required-summary` aggregates every policy-designated CI job, including compatibility,
consumer, UI, mutation, packaging, performance, schema, API-surface, and repository-integrity
checks. Failure, cancellation, timeout, neutral, or unexpected skip conclusions are rejected.

The current repository-age and solo-maintainer review limitations, their compensating controls,
and their removal conditions are also recorded in
[`docs/governance/vulnerability-reporting-and-review-policy.md`](../governance/vulnerability-reporting-and-review-policy.md).
