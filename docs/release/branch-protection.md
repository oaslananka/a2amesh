# Branch Protection

`main` is protected by the `main-protection` repository ruleset in `.github/rulesets/main.json`.

The required status checks are:

- `CI / identity`
- `CI / install`
- `CI / lint`
- `CI / typecheck`
- `CI / unit`
- `CI / integration`
- `CI / mutation`
- `CI / ui-e2e`
- `CI / build`
- `CI / package-dry-run`
- `CI / workspace-graph`
- `CI / public-surface`
- `CI / command-surface`
- `CI / no-generated-artifacts`
- `CI / compatibility-smoke (ubuntu-latest, node 22.22.3)`
- `CI / compatibility-smoke (windows-latest, node 24.16.0)`
- `CI / compatibility-smoke (macos-latest, node 24.16.0)`
- `Docs / build`
- `Docs / links`
- `Docs / command-parity`
- `Security / gitleaks`
- `Security / audit`
- `Security / osv`
- `Security / zizmor`
- `Security / actionlint`
- `Security / dependency-license`
- `Dependency Review / review`
- `CodeQL / analyze`
- `Scorecard / scan`

Repository-managed Renovate pull requests are created with the scoped `GITHUB_TOKEN`, so the Renovate workflow explicitly dispatches these required workflows on each immutable Renovate head SHA. Dependency Review receives the pull request base and head commit IDs as required workflow inputs; Docs dispatches always set `deploy=false`.

Apply or update rulesets with the GitHub REST rulesets API after the repository bootstrap commit has passed CI:

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
