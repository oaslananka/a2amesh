# Secrets management

## Repository policy

- Do not commit secrets, tokens, API keys, registry tokens, private keys, or credentials.
- Keep `.env.example` values non-sensitive placeholders only.
- Prefer GitHub OIDC, trusted publishing, and GitHub App installation tokens over long-lived
  personal or registry tokens.
- Keep workflow permissions least-privilege and scoped to the job that needs them.
- Do not expose repository or environment secrets to `pull_request_target` workflows or other
  untrusted-code execution paths.
- Keep secret scanning and push protection enabled where the GitHub plan permits.

The machine-readable inventory is
[`github-actions-credentials.json`](github-actions-credentials.json). `node
scripts/check-security-tooling.mjs` compares every `${{ secrets.NAME }}` workflow reference with
that inventory, rejects undocumented references and broad `write-all` permissions, and fails after
the inventory exceeds its 90-day refresh cadence.

## Current GitHub Actions credential model

Observed through the GitHub API on **2026-07-23**. The repository owner, `@oaslananka`, owns the
review and refresh process.

### Repository secrets

| Secret          | Purpose                                               | Consumer                   | Rotation path                                                                                        |
| --------------- | ----------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CODECOV_TOKEN` | Upload unit coverage and test-result reports securely | `.github/workflows/ci.yml` | Create a replacement in Codecov, update GitHub, verify one CI upload, then revoke the previous token |

All other repository-level credentials present during the audit were removed because no workflow
referenced them. The removed names are recorded in the machine-readable inventory so the cleanup is
auditable without preserving any credential value.

### `npm-publish` environment

| Control                    | Current state                                                                   |
| -------------------------- | ------------------------------------------------------------------------------- |
| Allowed deployment branch  | `main` only through a custom environment branch policy                          |
| Required reviewer          | `@oaslananka`                                                                   |
| Self-review                | Allowed while the project has one active maintainer                             |
| Static environment secrets | None                                                                            |
| npm authentication         | GitHub OIDC trusted publishing with job-scoped `id-token: write`                |
| Workflow guard             | Canonical repository and `refs/heads/main` required before the publish job runs |
| Admin bypass               | Available only under the emergency-bypass and retrospective governance policy   |

When a second active maintainer is available, set `prevent_self_review` to `true` and require the
independent maintainer as an environment reviewer in the same governance change that enables
mandatory pull-request review.

## Fork and untrusted pull requests

GitHub does not pass repository secrets to pull requests from forks. The Codecov upload steps also
require a non-empty `CODECOV_TOKEN`, so untrusted pull requests can run tests without receiving or
attempting to use the credential. Publishing is manual, runs only from canonical `main`, and is
protected by the `npm-publish` environment.

## Review and refresh procedure

At least quarterly, the maintainer must:

1. list repository and environment secrets and compare them with the inventory;
2. search workflow files for `${{ secrets.NAME }}` references;
3. remove credentials with no declared consumer;
4. verify the `npm-publish` environment branch policy and reviewers;
5. verify npm trusted-publisher configuration and the absence of static npm credentials; and
6. update the observation date, owners, consumers, and rotation paths.

A changed workflow secret reference without a matching inventory entry fails repository validation.

## PR review triggers

Changes require explicit security review when they touch publish workflows, GitHub Actions
permissions, token scopes, secret names, OIDC/trusted publishing configuration, runtime secret
redaction, or logging behavior.

## Emergency rotation and revocation

If a credential is exposed or suspected compromised:

1. revoke it at the provider before changing repository history;
2. disable or pause the consuming workflow when immediate revocation is not possible;
3. create a replacement with the minimum scope and shortest practical lifetime;
4. update the GitHub secret or trusted-publisher relationship;
5. verify one controlled workflow run;
6. review GitHub audit logs, workflow logs, and provider access logs; and
7. record the incident and follow-up actions without disclosing the credential value.

Do not rely only on deleting a secret from git history.
