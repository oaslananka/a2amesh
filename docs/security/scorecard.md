# OpenSSF Scorecard

The Scorecard workflow runs on GitHub-hosted runners with read-only contents permission and uploads
SARIF when the event permits it. Findings are triaged as security, CI, supply-chain, or governance
work rather than accepted as automatically actionable defects.

Pull requests expose `CI / tests-required`, a fail-closed summary of unit, integration, and
conformance jobs. This explicit test-named check provides detector-friendly CI evidence while the
underlying jobs remain independently required.

The current repository-age and solo-maintainer review limitations, their compensating controls,
and their removal conditions are recorded in
[`docs/governance/vulnerability-reporting-and-review-policy.md`](../governance/vulnerability-reporting-and-review-policy.md).
