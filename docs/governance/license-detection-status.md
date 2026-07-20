# GitHub License Detection Investigation (#71)

## Symptom

Before this correction, the GitHub repository and license APIs reported `Other` / `NOASSERTION`
even though the repository used Apache-2.0 package metadata and passed REUSE validation.

## Root cause

`LICENSE` and `LICENSES/Apache-2.0.txt` were byte-identical to each other, but neither was the
canonical Apache-2.0 text. The reconstructed copies omitted several phrases and punctuation from
Sections 1, 3, 7, and 8 while retaining the appendix. Comparing only the two repository copies hid
that drift.

The canonical body published by the Apache Software Foundation and the body used by GitHub's
Choose a License repository are byte-identical. Their SHA-256 digest is:

```text
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
```

The previous repository copies had digest:

```text
8d77d3ae499241b80741a70fde2eb67a4579501e05dd0f497debe7dd6944ce55
```

## Correction and regression protection

Both repository copies now contain the unmodified canonical Apache-2.0 body. The integration test
`tests/integration/license-corpus.test.ts` requires both files to match the canonical digest and
requires every Release Please-managed public package to declare `Apache-2.0`.

REUSE remains the source for per-file license compliance. The exact-digest test serves a different
purpose: it prevents two mutually matching but noncanonical license copies from passing unnoticed.

## Default-branch verification

GitHub recalculates detected repository license metadata from the default branch. After this change
reaches `main`, verify both the repository sidebar and `GET /repos/oaslananka/a2amesh/license` report
`Apache-2.0`. If the canonical digest is present on `main` while GitHub still reports
`NOASSERTION`, record the timestamp and treat the remaining discrepancy as platform-side detection
or cache lag rather than modifying the legal text again.
