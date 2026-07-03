# GitHub License Detection Investigation (#71)

**Symptom:** the GitHub repository API (`GET /repos/oaslananka/a2amesh`) reports
`license.key = "other"`, `license.spdx_id = "NOASSERTION"` instead of `apache-2.0`, even though the
repository has a `LICENSE` file and every `package.json` declares `"license": "Apache-2.0"`.

## Root cause found

An earlier pass on this file concluded `LICENSE` was byte-identical to the canonical SPDX
Apache-2.0 text because `diff LICENSE LICENSES/Apache-2.0.txt` showed no difference — but both
copies were compared only against each other, not against the real canonical text. Both files were
in fact **truncated at 171 lines**, ending right after `END OF TERMS AND CONDITIONS` and missing the
final `APPENDIX: How to apply the Apache License to your work.` section (with the
`Copyright [yyyy] [name of copyright owner]` boilerplate) that is part of the actual Apache-2.0
license text in `spdx/license-list-data`.

GitHub's `licensee` gem (and REUSE's own license corpus) score a `LICENSE` file by similarity against
the full canonical text, appendix included. A file missing roughly the last 15% of that text falls
below the confidence threshold `licensee` needs to report a known SPDX identifier, so it fell back to
`"other"` / `NOASSERTION` even though everything present in the file was word-for-word correct
Apache-2.0 text.

## Fix

Restored the missing `APPENDIX` section (standard, unmodified Apache-2.0 boilerplate) to both
`LICENSE` and `LICENSES/Apache-2.0.txt`, so both files now match the full canonical Apache-2.0 text
used by GitHub's detector and by REUSE.

## Manual follow-up

GitHub's `licensee` re-runs on pushes to the default branch that touch `LICENSE`. Once this change
reaches `main`, confirm the repository sidebar / `GET /repos/oaslananka/a2amesh` reports
`license.spdx_id = "Apache-2.0"`. If it still reports `NOASSERTION` after that push, allow for normal
detection lag before treating this as a GitHub-side issue — the file itself is now the complete,
correct canonical text.
