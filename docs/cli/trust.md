# a2amesh trust

<!-- Synced from scripts/generate-command-docs.mjs. -->

Signs Agent Cards with a private key, verifies signatures against trusted public keys, and inspects the append-only, hash-chained trust log a registry keeps for trusted registrations.

## Usage

```text
Usage: a2amesh trust [options] [command]

Signs Agent Cards with a private key, verifies signatures against trusted public keys, and inspects
the append-only, hash-chained trust log a registry keeps for trusted registrations.

Options:
  -h, --help                    display help for command

Commands:
  sign [options] <card-file>    Sign an Agent Card with a private key.
  verify [options] <card-file>  Verify an Agent Card signature against one or more trusted public
                                keys.
  log [options]                 List entries from a registry trust log.
  help [command]                display help for command
```

## Subcommands

| Command                | Summary                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `a2amesh trust sign`   | Sign an Agent Card with a private key.                                  |
| `a2amesh trust verify` | Verify an Agent Card signature against one or more trusted public keys. |
| `a2amesh trust log`    | List entries from a registry trust log.                                 |

## Examples

### Sign an Agent Card and verify it against the matching public key. (Linux/macOS)

```bash
a2amesh trust sign ./agent-card.json --key ./signing-key.pem --key-id my-key --alg ES256 --output ./agent-card.signed.json
a2amesh trust verify ./agent-card.signed.json --trusted-key my-key:./public-key.pem
```

### Sign an Agent Card and verify it against the matching public key. (PowerShell)

```powershell
a2amesh trust sign .\agent-card.json --key .\signing-key.pem --key-id my-key --alg ES256 --output .\agent-card.signed.json
a2amesh trust verify .\agent-card.signed.json --trusted-key my-key:.\public-key.pem
```

### Inspect a registry trust log. (Linux/macOS)

```bash
a2amesh trust log --url http://127.0.0.1:3099 --limit 20
```

### Inspect a registry trust log. (PowerShell)

```powershell
a2amesh trust log --url http://127.0.0.1:3099 --limit 20
```

## Trust Log

Every registry appends an entry to its trust log when an Agent Card registration is verified as `trusted` (signed with a key the registry was configured to trust). Each entry records a SHA-256 `cardHash` of the canonicalized, signature-less card plus an `entryHash` chained from the previous entry, so tampering with an earlier entry changes every hash after it. The log is exposed read-only at `GET /trust-log` and `GET /trust-log/:cardHash`.
