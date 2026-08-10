# a2amesh release-check

<!-- Synced from scripts/generate-command-docs.mjs. -->

Runs the release readiness checklist: git worktree state, release config integrity, pack dry-run, schema generation, docs build, security audit, public surface, and release artifact validation. Current-channel checks include npm registry parity; --stable instead validates the unpublished stable candidate and defers registry parity to the protected post-publish gate. Exits non-zero if any applicable check fails.

## Usage

```text
Usage: a2amesh release-check [options]

Runs the release readiness checklist: git worktree state, release config integrity, pack dry-run,
schema generation, docs build, security audit, public surface, and release artifact validation.
Current-channel checks include npm registry parity; --stable instead validates the unpublished
stable candidate and defers registry parity to the protected post-publish gate. Exits non-zero if
any applicable check fails.

Options:
  --stable    Require stable package versions and public surface inventories
  -h, --help  display help for command
```

## Examples

### Run release readiness checks. (Linux/macOS)

```bash
a2amesh release-check
```

### Run release readiness checks. (PowerShell)

```powershell
a2amesh release-check
```

### Emit machine-readable JSON report. (Linux/macOS)

```bash
a2amesh release-check --json
```

### Emit machine-readable JSON report. (PowerShell)

```powershell
a2amesh release-check --json
```

### Evaluate stable-release readiness. (Linux/macOS)

```bash
a2amesh release-check --stable --json
```

### Evaluate stable-release readiness. (PowerShell)

```powershell
a2amesh release-check --stable --json
```
