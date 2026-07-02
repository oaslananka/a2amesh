# Secrets management

## Repository policy

- Do not commit secrets, tokens, API keys, registry tokens, private keys, or credentials.
- Keep `.env.example` values non-sensitive placeholders only.
- Prefer GitHub OIDC/trusted publishing over long-lived npm/PyPI tokens where supported.
- Keep workflow permissions least-privilege.
- Keep secret scanning and push protection enabled where the GitHub plan permits.

## Release and registry credentials

Publishing credentials are human-managed GitHub/repository/registry settings. They must not be documented as raw values or committed to the repository.

## PR review triggers

Changes require explicit security review when they touch publish workflows, GitHub Actions permissions, token scopes, secret names, OIDC/trusted publishing configuration, runtime secret redaction, or logging behavior.

## Incident handling

If a secret is exposed, revoke it first, rotate affected credentials, and then review logs and workflow history. Do not rely only on deleting the secret from git history.
