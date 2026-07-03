# GitHub License Detection Investigation (#71)

**Symptom:** the GitHub repository API (`GET /repos/oaslananka/a2amesh`) reports
`license.key = "other"`, `license.spdx_id = "NOASSERTION"` instead of `apache-2.0`, even though the
repository has a `LICENSE` file and every `package.json` declares `"license": "Apache-2.0"`.

## What was verified

1. **`LICENSE` content is byte-identical to the canonical SPDX Apache-2.0 text.**
   `diff LICENSE LICENSES/Apache-2.0.txt` returns no differences (both 171 lines). The
   `LICENSES/Apache-2.0.txt` copy is the reference text pulled in by the REUSE toolchain from
   `spdx/license-list-data`, which is the same corpus GitHub's `licensee` gem uses for its own
   comparison. There is no stray whitespace, CRLF line endings, BOM, or truncation —
   `file LICENSE` reports plain ASCII text, and a hex dump of the first bytes shows a clean
   `Apache License\nVersion 2.0, January 2004\n...` start.
2. **No conflicting license files exist.** The repository root only has `LICENSE` (the file) and
   `LICENSES/` (the REUSE per-license-text directory, which is a recognized REUSE convention, not a
   second candidate license for the repo itself).
3. **`REUSE.toml` and every package's `package.json` consistently declare `Apache-2.0`.**
   `pnpm run security` (which now runs `reuse lint` deterministically — see #86) passes, confirming
   every file in the tree has correct `SPDX-License-Identifier` coverage.
4. **No `.gitattributes` or `linguist-*` overrides** hide or reclassify the `LICENSE` file.

## Conclusion

The `LICENSE` file content is objectively correct and matches the canonical SPDX Apache-2.0 text
exactly. This repository was created on 2026-06-28 (per `GET /repos/oaslananka/a2amesh`,
`created_at`); GitHub's license detector (`licensee`) runs at repository creation/import time and on
subsequent pushes to the default branch, but detection results can lag behind file changes,
especially on a very young, actively-changing repository. Given the file itself is verified correct,
this reads as a stale/cache artifact rather than a real licensing defect.

## Manual follow-up if "Other" persists after this branch merges to `main`

1. Confirm on GitHub's repository page (the sidebar "License" widget) whether
   it now shows Apache-2.0 after a fresh push to `main` triggers re-detection.
2. If it still reports "Other" after a subsequent push, a maintainer can force re-detection by
   making a trivial content-preserving commit to `LICENSE` (e.g., touching the file) on `main`, since
   GitHub's detector re-runs on file changes to `LICENSE` specifically.
3. If detection still does not resolve, this is a GitHub-side product issue outside this
   repository's control; file feedback via GitHub Support referencing the exact `spdx_id: NOASSERTION`
   response for a byte-identical Apache-2.0 `LICENSE` file.

No further local code change is expected to fix this — the artifact under this repository's control
(the LICENSE file itself) is already correct.
