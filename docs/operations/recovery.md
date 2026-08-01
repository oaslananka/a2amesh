# Backup, Restore, and Disaster Recovery

This runbook defines the recovery guarantees that A2A Mesh can verify in the repository. It separates the supported hardened single-node SQLite drill from shared Redis registry state and from full-platform high availability.

## Supported topology and non-goals

The supported production baseline is:

- one SQLite-backed registry replica on persistent storage;
- a separate registry trust-log SQLite file on the same protected volume;
- one runtime replica unless the application provides a shared task store and idempotent provider execution;
- optional external Redis registry state for the agent directory, trust log, and distributed polling leases;
- optional application-owned SQLite task and Fleet databases;
- `minAvailable: 1` PDBs that block voluntary eviction until an operator explicitly accepts a maintenance outage;
- daily verified backups copied to at least one independent failure domain.

This is not an HA topology for the full platform. Redis-backed registry replicas share directory, trust-log, and lease state, but the repository does not provide multi-writer SQLite, a shared runtime task store, cross-region traffic failover, or transparent in-flight task migration. A deployment must not claim full-platform HA merely because Kubernetes or Redis restarts a component.

Redis-backed registry state is an external dependency containing registered agents, query indexes, the canonical trust-log chain, and polling leases. The SQLite recovery CLI does not back up Redis. Production Redis use requires provider-managed persistence or point-in-time recovery, encrypted transport and storage, a documented provider RPO/RTO, and a separately witnessed restore drill that verifies agent inventory and the trust-chain head after recovery.

## Data ownership

| Dataset              | Typical path or setting              | Recovery owner      | Repository drill |
| -------------------- | ------------------------------------ | ------------------- | ---------------- |
| Registry agents      | `REGISTRY_SQLITE_PATH`               | Registry operator   | Yes              |
| Registry trust log   | `REGISTRY_TRUST_LOG_PATH`            | Registry operator   | Yes              |
| Runtime tasks        | Application-owned SQLite             | Runtime application | Yes              |
| Fleet state/audit    | Application-owned SQLite             | Fleet application   | Yes              |
| Registry Redis state | `REGISTRY_REDIS_URL` / provider PITR | Platform operator   | No               |
| Provider-side tasks  | Provider-specific control            | Provider operator   | No               |

Back up every SQLite file independently. Do not assume that backing up `registry.sqlite` also protects a separately configured trust-log file.

## Objectives and retention

The versioned policy is `ops/recovery/recovery-policy.json`.

| Objective                   | Target                                                  |
| --------------------------- | ------------------------------------------------------- |
| Production RPO              | At most 24 hours                                        |
| Production RTO              | At most 30 minutes for a manual single-node restore     |
| Stale-backup alert          | No verified backup for more than 25 hours               |
| Disposable drill RPO        | At most 5 seconds                                       |
| Disposable drill RTO        | At most 120 seconds                                     |
| Verified backup retention   | Latest 14 complete backup sets per dataset              |
| Independent copy            | At least one copy outside the workload failure domain   |
| Diagnostic bundle retention | 14 days unless incident policy requires a shorter limit |

The RPO starts at the creation time of the latest verified backup manifest. The RTO ends only after restore, SHA-256 verification, SQLite `quick_check`, application reopen, and data assertions pass. Verified sets must be transferred over encrypted transport and stored encrypted in an independent failure domain; repository tooling validates integrity but intentionally leaves encryption-key custody to the operator.

## Backup procedure

`backup` uses Node's online SQLite backup API. The source database may remain open while the snapshot is taken. The command validates the source, writes a private temporary snapshot, validates the snapshot, computes SHA-256, and atomically publishes the database plus a path-redacted manifest.

```bash
node scripts/recovery-cli.mjs backup \
  --dataset registry-agents \
  --source /var/lib/a2amesh/registry.sqlite \
  --output /srv/a2amesh-backups \
  --keep-count 14
```

```powershell
node scripts/recovery-cli.mjs backup `
  --dataset registry-agents `
  --source C:\a2amesh\registry.sqlite `
  --output C:\a2amesh-backups `
  --keep-count 14
```

Run the command separately for the trust log, runtime task database, and Fleet database. Copy the completed `.sqlite` and `.manifest.json` pair to independent storage only after `verify` succeeds.

```bash
node scripts/recovery-cli.mjs verify \
  --manifest /srv/a2amesh-backups/registry-agents-<timestamp>.manifest.json
```

```powershell
node scripts/recovery-cli.mjs verify `
  --manifest C:\a2amesh-backups\registry-agents-<timestamp>.manifest.json
```

A backup set is valid only when the observed size, SHA-256 digest, and SQLite `quick_check` match its manifest. A copied database without its matching manifest is not release or recovery evidence.

## Restore procedure

Restore is an offline operation. Stop the process or scale the workload to zero before replacing a database. Confirm that no process can reopen the target during the swap. For Kubernetes, run the recovery CLI inside an operator-controlled temporary pod or equivalent environment with the registry PVC mounted at `/var/lib/a2amesh`; the path is not a host-runner path.

For the Helm registry:

```bash
kubectl scale statefulset/a2amesh-registry \
  --namespace a2amesh \
  --replicas 0
kubectl wait \
  --namespace a2amesh \
  --for=delete pod/a2amesh-registry-0 \
  --timeout=5m
```

```powershell
kubectl scale statefulset/a2amesh-registry `
  --namespace a2amesh `
  --replicas 0
kubectl wait `
  --namespace a2amesh `
  --for=delete pod/a2amesh-registry-0 `
  --timeout=5m
```

Verify the selected manifest, then restore with explicit replacement:

```bash
node scripts/recovery-cli.mjs restore \
  --manifest /srv/a2amesh-backups/registry-agents-<timestamp>.manifest.json \
  --target /var/lib/a2amesh/registry.sqlite \
  --replace
```

```powershell
node scripts/recovery-cli.mjs restore `
  --manifest C:\a2amesh-backups\registry-agents-<timestamp>.manifest.json `
  --target C:\a2amesh\registry.sqlite `
  --replace
```

The command refuses to overwrite an existing target without `--replace`. Replacement preserves the previous database and any WAL/SHM sidecars with a `.pre-restore-<timestamp>` suffix. Keep those rollback files until the restored service passes health, schema, inventory, trust-chain, task, and audit checks.

Restart the service and verify:

```bash
kubectl scale statefulset/a2amesh-registry \
  --namespace a2amesh \
  --replicas 1
kubectl rollout status statefulset/a2amesh-registry \
  --namespace a2amesh \
  --timeout=10m
kubectl port-forward \
  --namespace a2amesh \
  service/a2amesh-registry 3099:3099
```

```powershell
kubectl scale statefulset/a2amesh-registry `
  --namespace a2amesh `
  --replicas 1
kubectl rollout status statefulset/a2amesh-registry `
  --namespace a2amesh `
  --timeout=10m
kubectl port-forward `
  --namespace a2amesh `
  service/a2amesh-registry 3099:3099
```

Do not delete rollback files until the restored data set and application metrics are verified.

## Automated recovery drill

The disposable drill creates state through the real registry agent, trust-log, runtime task, and Fleet SQLite implementations. It takes online snapshots, writes post-backup records, restores to fresh files, proves that pre-backup state exists and post-backup state does not, emits Prometheus metrics, and creates a redacted diagnostic bundle.

```bash
pnpm run build
pnpm run recovery:drill
```

```powershell
pnpm run build
pnpm run recovery:drill
```

The required `CI / recovery` job runs the drill on pull requests, merge queues, and `main`, validates alert rules with pinned `promtool`, and uploads only the report, metrics, manifests, and redacted bundle. Source databases and restored databases are not uploaded.

## Upgrade, rollback, and failure matrix

| Scenario                      | Verified behavior                                                                                                                              | Operator action                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry pod restart          | Persistent SQLite survives pod recreation when the PVC remains available.                                                                      | Verify sentinel data, health, trust-log head, and recovery metrics.                                                                           |
| Rolling chart upgrade         | Helm waits for readiness; the persistent registry data set must remain present.                                                                | Verify sentinel data before and after upgrade.                                                                                                |
| Chart rollback                | Helm restores the prior revision; the persistent data set remains on the PVC.                                                                  | Verify sentinel data and schema compatibility before declaring recovery.                                                                      |
| Voluntary node drain          | Single-replica PDBs block eviction.                                                                                                            | Back up, announce outage, explicitly disable both PDBs, drain, uncordon, and restore production values.                                       |
| Involuntary node or disk loss | Kubernetes restart alone cannot recover lost local/PVC data.                                                                                   | Provision replacement storage and restore the latest independently stored verified backup.                                                    |
| Registry dependency outage    | `A2AMeshRegistryNoHealthyAgents` fires in the controlled Prometheus rule test.                                                                 | Check registry reachability, CNI policy, DNS, agent heartbeat paths, and data integrity.                                                      |
| Partial network failure       | Calico lifecycle tests prove unrelated namespace denial and private/metadata egress denial while required chart-internal paths remain allowed. | Compare rendered policies and CNI events; do not weaken policy globally.                                                                      |
| Runtime process loss          | Process-local in-flight work may be lost unless the application uses durable task storage and provider-side idempotency.                       | Reconcile durable tasks and provider state before retrying.                                                                                   |
| Redis outage                  | Registry replicas lose shared directory, trust-log, and lease access until Redis recovers.                                                     | Follow the provider failover/PITR runbook, then verify agent inventory, trust-chain order/head, and lease acquisition before resuming writes. |

## Graceful shutdown and in-flight tasks

Readiness removes a terminating pod from new traffic, but it does not make an external provider operation transactional. Keep the termination grace period longer than the application's bounded drain period. Applications must:

1. stop accepting new tasks when shutdown begins;
2. finish or persist in-flight state before exit;
3. record idempotency identifiers before invoking providers;
4. reconcile provider-side completion after restart;
5. avoid retrying an unknown provider outcome without idempotency protection.

The default runtime remains a single replica because task state is process-local unless an application explicitly supplies durable shared storage. Backup protects persisted state; it cannot recover an operation that was never persisted.

## Alert runbooks

### Backup integrity failure

`A2AMeshBackupIntegrityFailed` is critical.

1. Quarantine the failed backup and do not copy it to the retention tier.
2. Run `verify` against the previous backup set.
3. Check source disk health, free space, SQLite `quick_check`, and backup job logs.
4. Create a fresh snapshot and verify it.
5. Escalate if no valid backup remains inside the production RPO.

### Stale backup

`A2AMeshBackupStale` is critical after the 25-hour window.

1. Confirm whether the scheduler ran and whether recovery metrics were published.
2. Check output storage capacity and permissions.
3. Run a manual backup and verify it.
4. Copy the set to the independent failure domain.
5. Record the RPO breach and corrective action.

### RTO exceeded

`A2AMeshRecoveryRtoExceeded` is a warning.

1. Break down restore time into artifact retrieval, verification, database swap, startup, and data validation.
2. Check database size, storage throughput, WAL growth, and schema migration time.
3. Rehearse with production-sized sanitized data.
4. Adjust capacity or the stated objective; do not silently ignore repeated breaches.

### Recovery drill failure

`A2AMeshRecoveryDrillFailed` is critical.

1. Preserve the redacted workflow artifact.
2. Identify whether backup, digest, SQLite integrity, restore, data assertion, alert test, or bundle validation failed.
3. Do not promote a release while the recovery gate is failing.
4. Repair the failing stage and rerun the complete drill.

## Diagnostic evidence

A recovery incident bundle must contain the files in `ops/recovery/diagnostic-bundle-manifest.json`, including `recovery-report.json` and `recovery-metrics.prom`. Generate and validate a bundle with:

```bash
node scripts/recovery-cli.mjs bundle \
  --manifest ops/recovery/diagnostic-bundle-manifest.json \
  --source .artifacts/recovery/diagnostic-source \
  --output .artifacts/recovery/diagnostic-bundle
node scripts/recovery-cli.mjs bundle-verify \
  --manifest ops/recovery/diagnostic-bundle-manifest.json \
  --bundle .artifacts/recovery/diagnostic-bundle
```

```powershell
node scripts/recovery-cli.mjs bundle `
  --manifest ops/recovery/diagnostic-bundle-manifest.json `
  --source .artifacts\recovery\diagnostic-source `
  --output .artifacts\recovery\diagnostic-bundle
node scripts/recovery-cli.mjs bundle-verify `
  --manifest ops/recovery/diagnostic-bundle-manifest.json `
  --bundle .artifacts\recovery\diagnostic-bundle
```

The builder redacts authorization values, credential-like environment variables, cookies, token query parameters, raw task input, private keys, private IPs, and private URLs. The bundle index contains basenames, sizes, and SHA-256 digests; it does not contain absolute source paths.

## Capacity and tuning

Track database size, backup duration, restore duration, free space, and WAL growth for every dataset.

- Keep free space for the live database, WAL, one temporary backup, one restore staging file, and one rollback copy.
- Schedule backups away from sustained write peaks when possible. Online backup is consistent but concurrent writers can increase completion time.
- Keep SQLite `busy_timeout` within the application's validated range.
- Run a production-sized sanitized drill before increasing database or artifact limits.
- Treat a restore that passes SQLite integrity but exceeds the stated RTO as an operational failure.
- Do not place the only backup on the same PVC, node, account, or failure domain as the live database.

## Verification

```bash
pnpm run recovery:check
pnpm run recovery:alerts
pnpm run recovery:drill
```

```powershell
pnpm run recovery:check
pnpm run recovery:alerts
pnpm run recovery:drill
```
