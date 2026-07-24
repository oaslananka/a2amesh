# Branch Protection

`main` is protected by GitHub classic branch protection. The file
`.github/rulesets/main.json` records the declarative desired state used for review, drift checks,
and a future ruleset migration; it is not evidence that a live repository ruleset is active.

## Required-check policy

The stable CI contexts required for every pull request and merge queue entry are:

- `CI / required-summary`
- `CI / tests-required`

`CI / required-summary` runs with `always()` and fails unless every policy-designated CI job
reports `success`. Failure, cancellation, timeout, neutral, or unexpectedly skipped conclusions are
rejected. The summary aggregates identity, installation, lint, type checking, unit and integration
tests, conformance, performance smoke, schemas, API surfaces, mutation, UI E2E/accessibility,
build and package dry-runs, workspace/public/command surfaces, generated-artifact checks, garbage
collection, compatibility lanes, consumer lanes, and `CI / tests-required`.

Path-conditional work must finish its job with an explicit successful no-op when it is not
applicable. It must not skip the whole job, because a skipped dependency fails the summary. The
mutation lane follows this contract by reporting success after its change detector when mutation
execution is unnecessary. Pull-request and `merge_group` events use the same workflow and stable
summary context.

External policy checks remain directly required because GitHub Actions cannot aggregate jobs from
separate workflows through `needs`. Their workflows also handle `merge_group`, so merge-queue
entries emit the same required contexts as pull requests. Dependency Review uses an explicit
successful merge-group no-op because every constituent pull request has already passed the real
dependency diff review before queue admission:

- `Docs / build`
- `Docs / links`
- `Docs / command-parity`
- `Security / gitleaks`
- `Security / audit`
- `Security / osv`
- `Security / zizmor`
- `Security / actionlint`
- `Security / semgrep`
- `Security / dependency-license`
- `Dependency Review / review`
- `CodeQL / analyze`
- `Scorecard / scan`

Repository-managed Renovate pull requests are created with the scoped `GITHUB_TOKEN`, so the
Renovate workflow explicitly dispatches required workflows on each immutable Renovate head SHA.
Dependency Review receives the pull request base and head commit IDs as required workflow inputs;
Docs dispatches always set `deploy=false`.

`pnpm run ci:required-summary:check` detects check-name, needs-graph, event, ruleset, and policy
documentation drift before it can weaken branch protection.

## Temporary bypass procedure

A temporary bypass is allowed only for a documented GitHub incident or a repository-blocking false
positive. The maintainer must open an incident issue, record the failing context and evidence,
identify the exact temporary protection change, and restore the required context before the next
unrelated merge. Force pushes and branch deletion remain blocked. A bypass must never convert a
failed, cancelled, timed-out, neutral, or unexpectedly skipped CI result into accepted evidence.

## Reconciliation

After a new required context has emitted successfully, reconcile classic branch protection through
the GitHub branch-protection API. To migrate the repository to rulesets later, apply the declarative
files with the GitHub REST rulesets API after the source commit has passed CI:

```powershell
gh api --method POST repos/oaslananka/a2amesh/rulesets --input .github/rulesets/main.json
gh api --method POST repos/oaslananka/a2amesh/rulesets --input .github/rulesets/release-tags.json
```

If a ruleset already exists, inspect it and update it by id:

```powershell
gh api repos/oaslananka/a2amesh/rulesets
gh api --method PUT repos/oaslananka/a2amesh/rulesets/<ruleset-id> --input .github/rulesets/main.json
```

If repository permission is missing, record the exact `gh api` failure in untracked `NEXT.md`.
