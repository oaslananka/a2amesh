import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import { mapArtifactRow, type ArtifactRow } from './SqliteTaskStorageRecords.js';
import {
  validatePersistedTaskArtifact,
  type PersistedTaskArtifact,
  type TaskAuditInput,
} from './TaskStorageContracts.js';

export interface SqliteArtifactOperationOptions {
  now: () => Date;
  appendAuditEntry(input: TaskAuditInput, now: () => Date): void;
}

export function saveArtifactToSqlite(
  db: SqliteDatabase,
  value: PersistedTaskArtifact,
  options: SqliteArtifactOperationOptions,
): PersistedTaskArtifact {
  const artifact = validatePersistedTaskArtifact(value);
  const task = db
    .prepare<{ tenant_id: string }>('SELECT tenant_id FROM tasks WHERE id = ?')
    .get(artifact.taskId);
  if (task?.tenant_id !== artifact.tenantId) {
    throw new Error('Artifact task does not exist in the requested tenant');
  }
  db.prepare(
    'INSERT INTO task_artifacts (task_id, artifact_id, tenant_id, content_type, checksum_sha256, payload_ref, size_bytes, sensitivity, redacted, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, artifact_id) DO UPDATE SET content_type = excluded.content_type, checksum_sha256 = excluded.checksum_sha256, payload_ref = excluded.payload_ref, size_bytes = excluded.size_bytes, sensitivity = excluded.sensitivity, redacted = excluded.redacted, provenance_json = excluded.provenance_json, created_at = excluded.created_at WHERE task_artifacts.tenant_id = excluded.tenant_id',
  ).run(
    artifact.taskId,
    artifact.artifactId,
    artifact.tenantId,
    artifact.contentType,
    artifact.checksumSha256.toLowerCase(),
    artifact.payloadRef,
    artifact.sizeBytes ?? null,
    artifact.sensitivity,
    artifact.redacted ? 1 : 0,
    JSON.stringify(artifact.provenance),
    artifact.createdAt,
  );
  options.appendAuditEntry(
    {
      taskId: artifact.taskId,
      tenantId: artifact.tenantId,
      action: 'artifact.persisted',
      outcome: 'success',
    },
    options.now,
  );
  return artifact;
}

export function listArtifactsFromSqlite(
  db: SqliteDatabase,
  tenantId: string,
  taskId: string,
): PersistedTaskArtifact[] {
  return db
    .prepare<ArtifactRow>(
      'SELECT task_id, artifact_id, tenant_id, content_type, checksum_sha256, payload_ref, size_bytes, sensitivity, redacted, provenance_json, created_at FROM task_artifacts WHERE tenant_id = ? AND task_id = ? ORDER BY artifact_id',
    )
    .all(tenantId, taskId)
    .map(mapArtifactRow);
}
