# OpenSSF Scorecard

The Scorecard workflow runs on GitHub-hosted runners with read-only contents permission and uploads
SARIF when the event permits it. Findings are triaged as security, CI, supply-chain, or governance
work rather than accepted as automatically actionable defects.

Pull requests and merge-queue entries expose two fail-closed summaries. `CI / tests-required`
provides detector-friendly unit, integration, and conformance evidence. `CI / required-summary`
aggregates every policy-designated CI job, including compatibility, consumer, UI, mutation,
packaging, performance, schema, API-surface, and repository-integrity checks. The stable summary
fails on failure, cancellation, timeout, neutral, or unexpected skip conclusions.

The current repository-age and solo-maintainer review limitations, their compensating controls,
and their removal conditions are recorded in
[`docs/governance/vulnerability-reporting-and-review-policy.md`](../governance/vulnerability-reporting-and-review-policy.md).
