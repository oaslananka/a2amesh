# Governance

A2A Mesh is currently maintained by one repository owner. This policy records current authority,
the objective trigger for stronger review enforcement, and the succession and audit controls that
apply as the maintainer group grows.

## Roles and authority

- **Maintainer:** `@oaslananka` currently holds merge, release, repository-administration, and final
  technical-decision authority. Maintainers also own security escalation until a separate security
  lead is appointed.
- **Security lead:** coordinates private vulnerability reports, containment, credential revocation,
  advisory publication, and post-incident review. The current maintainer fills this role.
- **Contributor:** anyone with a merged pull request. Contributors may triage and propose decisions
  but do not receive merge or release authority automatically.
- **Domain owner or Adapter Champion:** maintains a bounded package or integration area and is
  consulted through CODEOWNERS. This role does not by itself grant repository-administration or
  release authority.

A maintainer candidate must demonstrate at least three substantive merged changes, responsible
handling of review feedback, familiarity with the security and release policies, and sustained
participation across at least 60 days. Promotion is recorded in a pull request that updates this
file and CODEOWNERS.

## Review enforcement stages

The repository must not create a self-approval deadlock. While fewer than two active maintainers
exist, branch protection keeps the required approving review count at `0`; all changes still go
through pull requests, required CI/security checks, bot and agent review, and resolved review
threads.

When there are **two active maintainers**, an administrator must:

1. set the required approving review count to `1`;
2. require code-owner review for sensitive paths;
3. require approval of the last push by someone other than the author;
4. keep stale-review dismissal enabled; and
5. preserve the same review policy for pull-request and merge-queue events.

An active maintainer is a maintainer with repository activity or completed review duties in the
previous 90 days who has not announced an extended absence. The review-policy transition is made
in one auditable pull request that updates `.github/rulesets/main.json`, this file, branch-protection
documentation, and the live GitHub setting.

Until a second maintainer exists, security-sensitive changes must receive all available independent
evidence: required security workflows, CodeQL, Scorecard, dependency review, static-analysis bots,
and any available external subject-matter review. The author evaluates every finding before merge;
a green check is not a substitute for reading the result.

## Decisions, issues, and milestones

Breaking APIs, new public packages, trust-boundary changes, storage-model changes, and release or
security-policy changes require a public RFC or architecture decision record. The discussion period
is normally seven days unless an active security incident requires containment first. The final
decision and rejected alternatives are captured in the pull request, ADR, or linked discussion so
the decision record remains durable.

New issues are triaged with priority, type, area, and status labels. Work tied to a release objective
is assigned to the relevant milestone. Security reports remain private until coordinated disclosure.
Stale roadmap items are reviewed rather than silently carried forward.

## Emergency bypass and retrospective

A maintainer may use an administrator bypass only for an active security incident, a broken
protected branch, or a release/CI outage that prevents the normal pull-request path. The bypass must
be visible in GitHub's audit history, use the smallest possible change, and preserve a linked issue
or incident record. Normal protection is restored immediately after containment. A retrospective
is published within five business days, including the reason, exact bypass, validation evidence,
and prevention actions. The bypass may never be used only to avoid review latency.

## Access review and succession

Maintainers perform a quarterly access and ruleset review covering collaborators, GitHub Apps,
environments, repository and environment secrets, branch protection, tag rules, CODEOWNERS, and
release authority. Results are recorded in an issue or governance pull request even when no change
is required.

Succession begins when the sole maintainer announces departure, is unreachable for 90 days, or can
no longer administer releases and security response. Authority transfers to the most recently active
qualified maintainer; if none exists, a previously designated trusted contributor is invited through
an auditable repository-owner transfer process. Recovery material and publishing access must never
be transferred through a public issue. Every succession updates the maintainer roster, CODEOWNERS,
environment reviewers, and release credentials.

## Release process

1. Release Please derives release pull requests from Conventional Commits merged to `main`.
2. Contributors run the documented local checks and the protected branch requires repository CI,
   security, documentation, packaging, and compatibility checks.
3. A release pull request updates versions and changelogs but does not publish by itself.
4. A maintainer creates the release tag and GitHub Release deliberately, then dispatches the guarded
   publish workflow.
5. Publishing uses the protected environment and short-lived/OIDC credentials described by the
   release-integrity policy.

See [Vulnerability Reporting and Mandatory Review Policy](../docs/governance/vulnerability-reporting-and-review-policy.md)
for the current independent-review evidence and staged branch-protection state.
