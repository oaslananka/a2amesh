# @a2amesh/internal-worker-runtime

Fleet worker runtime lifecycle contracts, plus two reference `WorkerRuntimeContract` implementations for the Local Agent Mesh:

- `MockWorkerRuntimeAdapter` (`src/adapters/MockWorkerRuntimeAdapter.ts`): a deterministic, no-process adapter for tests and demos.
- `LocalCliWorkerRuntimeAdapter` (`src/adapters/LocalCliWorkerRuntimeAdapter.ts`): a generic local CLI adapter that runs a canonical absolute executable in a realpath-confined workspace, with no secret passthrough by default, output redaction, timeouts, cancellation, concurrency limits, and bounded file-descriptor-based artifact capture.

See the [Local Agent Mesh Quickstart](../../docs/fleet/quickstart.md) for a runnable end-to-end example.

## Compatibility

See [Compatibility](../../docs/compatibility.md).

## Local CLI security boundary

`LocalCliWorkerRuntimeAdapter` intentionally does not resolve bare command names through the host
`PATH`. Configure `command` and every `policy.commandAllowlist` entry as an absolute canonical
executable path (for Node.js, `realpathSync(process.execPath)` is portable). The workspace root,
working directory, executable, and artifact paths are canonicalized before use; symlink/junction
traversal is rejected. Artifact capture accepts only declared regular files, uses bounded reads and
file identity checks, and applies count, extension, per-file, aggregate-size, and UTF-8/binary
policies. Credential-shaped stdout/stderr and artifact metadata are redacted before emission.

On Linux and macOS artifact files are opened with `O_NOFOLLOW` in addition to pre/post canonical
path and inode checks. On Windows, canonical reparse-point/junction checks and pre/post file identity
checks provide the equivalent fail-closed boundary supported by Node.js.
