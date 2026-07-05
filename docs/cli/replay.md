# a2amesh replay

<!-- Synced from scripts/generate-command-docs.mjs. -->

Verifies a cassette's integrity hash chain, then replays its recorded task lifecycle (created, message, artifact, and state transitions) against a fresh in-process TaskManager, serving artifacts from the cassette instead of a real adapter, and reports whether the replayed sequence matches the recording.

## Usage

```text
Usage: a2amesh replay [options] <cassette>

Verifies a cassette's integrity hash chain, then replays its recorded task lifecycle (created,
message, artifact, and state transitions) against a fresh in-process TaskManager, serving artifacts
from the cassette instead of a real adapter, and reports whether the replayed sequence matches the
recording.

Arguments:
  cassette    path to a JSONL cassette file recorded by CassetteRecorder

Options:
  --step      print each recorded step before replaying
  -h, --help  display help for command
```

## Examples

### Replay a recorded cassette and print a summary. (Linux/macOS)

```bash
a2amesh replay ./task-123.cassette.jsonl
```

### Replay a recorded cassette and print a summary. (PowerShell)

```powershell
a2amesh replay .\task-123.cassette.jsonl
```

### Print each recorded step. (Linux/macOS)

```bash
a2amesh replay ./task-123.cassette.jsonl --step
```

### Print each recorded step. (PowerShell)

```powershell
a2amesh replay .\task-123.cassette.jsonl --step
```
