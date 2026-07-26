# Verification performance and build reuse

The repository exposes three verification modes with the same policy-owned checks but different
build-state assumptions.

## Commands

Use the warm full gate when the current workspace already has valid build outputs:

```bash
pnpm run verify
```

Use the deterministic clean gate after changing the compiler, workspace graph, package manifests,
lockfile, runtime versions, or build configuration:

```bash
pnpm run verify:clean
```

Use the changed-scope gate for the local pre-push feedback loop:

```bash
pnpm run verify:changed
```

`verify` and `verify:clean` execute exactly one workspace build. Typecheck, coverage, integration, schema, OpenAPI, and documentation stages then consume that
verified output through `:no-build` commands. CI conformance and performance jobs consume the same
verified artifact through their own `:no-build` entry points. The root workspace build already includes the documentation site, so the full
verification plan does not invoke a second documentation build.

## Timing evidence and budgets

Each full verification writes machine-readable evidence to
`.artifacts/verification/timings.json` and a Markdown summary to
`.artifacts/verification/timings.md`. The report records the mode, start and finish times, total
runtime, budget status, and every stage command and duration. GitHub Actions also appends the same
Markdown table to `GITHUB_STEP_SUMMARY` when the runner is used in automation.

The regression budgets are:

- warm full verification: **30 minutes**;
- clean full verification: **45 minutes**.

The normal commands record but do not enforce the budget, which keeps heterogeneous contributor
machines usable. Release or benchmarking hosts can make the budget fail-closed:

```bash
pnpm run verify:budget
pnpm run verify:clean:budget
```

On the reference `ops-vps-1` host at commit `ef5c341`, the pre-change clean workspace build took
**331.48 seconds**. The first measured warm build after this change took **52.53 seconds**, an
approximately **84%** reduction. The complete warm verification gate then passed in **15 minutes
29.4 seconds**, within the **30-minute** budget. Timing evidence should be reviewed whenever the
build graph, compiler, or generated-source behavior changes.

## Incremental and clean builds

`pnpm run build` uses TypeScript project-reference state when outputs exist. It still forces the
first compilation when a package has no `dist` directory. Generated CLI sources are rewritten only
when their content changes, so an unchanged warm build does not invalidate downstream projects.

`pnpm run build:clean` removes workspace `dist` directories, direct and package-local
`tsconfig.tsbuildinfo` files, the VitePress output, and prior build-manifest evidence before running
the normal build. This command is the cache-miss and reproducibility reference path.

## CI build artifact isolation

The `CI / build` job performs one clean build and uploads
`workspace-build-${{ github.sha }}-${{ github.run_attempt }}`. The artifact name is scoped to the
exact commit and workflow attempt, so outputs cannot cross pull requests, commits, reruns, operating
systems, Node versions, lockfiles, compiler versions, or configuration changes. The commit SHA
therefore acts as the complete invalidation key for source and repository-owned configuration.

The artifact contains deterministic package, application, and example `dist` outputs plus TypeScript
incremental metadata. VitePress output is still validated by the build job but is excluded from the
shared artifact because downstream jobs do not consume it and its content-hashed assets are not
byte-stable across clean builds. Before any job uses restored files, `scripts/build-artifact-manifest.mjs` recomputes the exact file set, byte sizes,
and **SHA-256** digests. Missing, unexpected, or modified output fails the job. The restore action
then synchronizes injected pnpm workspace copies from the verified canonical `dist` directories.
Artifacts expire after one day and are not used as a cross-run cache.

## Reproducibility check

A reproducibility comparison can be performed without trusting warm state:

```bash
pnpm run build:clean
pnpm run build:manifest
cp .artifacts/build/manifest.json /tmp/a2amesh-build-manifest.json
pnpm run build:clean
node scripts/build-artifact-manifest.mjs --verify /tmp/a2amesh-build-manifest.json
```

On PowerShell, replace `cp` with `Copy-Item`. The final command compares the exact output set and
content hashes from two clean builds. On the 2026-07-27 reference run, two independent clean builds
produced the same **956-file** manifest with no missing, additional, size-mismatched, or hash-mismatched
files; the second clean build completed in **379.24 seconds**.
