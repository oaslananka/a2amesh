# @a2amesh/internal-worker-runtime

Fleet worker runtime lifecycle contracts, plus two reference `WorkerRuntimeContract` implementations for the Local Agent Mesh:

- `MockWorkerRuntimeAdapter` (`src/adapters/MockWorkerRuntimeAdapter.ts`): a deterministic, no-process adapter for tests and demos.
- `LocalCliWorkerRuntimeAdapter` (`src/adapters/LocalCliWorkerRuntimeAdapter.ts`): a generic local CLI adapter that runs an allowlisted command in a scoped workspace, with no secret passthrough by default, timeouts, cancellation, concurrency limits, and checksummed artifact capture.

See the [Local Agent Mesh Quickstart](../../docs/fleet/quickstart.md) for a runnable end-to-end example.

## Compatibility

See [Compatibility](../../docs/compatibility.md).
