export type TaskArtifactSensitivity = 'public' | 'internal' | 'confidential' | 'secret';

export interface TaskArtifactProvenance {
  producerId: string;
  taskId: string;
  workspace?: string | undefined;
  branch?: string | undefined;
  commit?: string | undefined;
  commandHash?: string | undefined;
}

export interface PersistedTaskArtifact {
  taskId: string;
  artifactId: string;
  tenantId: string;
  contentType: string;
  checksumSha256: string;
  payloadRef: string;
  sizeBytes?: number | undefined;
  sensitivity: TaskArtifactSensitivity;
  redacted: boolean;
  provenance: TaskArtifactProvenance;
  createdAt: string;
}

export interface TaskAuditEntry {
  sequence: number;
  taskId: string;
  tenantId: string;
  principalId?: string | undefined;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  timestamp: string;
  correlationId?: string | undefined;
}

export interface TaskAuditInput extends Omit<TaskAuditEntry, 'sequence' | 'timestamp'> {
  timestamp?: string | undefined;
}

export interface TaskRetentionPolicy {
  tenantId: string;
  completedTtlMs?: number | undefined;
  failedTtlMs?: number | undefined;
  canceledTtlMs?: number | undefined;
  rejectedTtlMs?: number | undefined;
  stalePausedTtlMs?: number | undefined;
  now?: Date | undefined;
}

export interface TaskCleanupResult {
  tenantId: string;
  deletedTasks: number;
  deletedArtifacts: number;
  evaluatedAt: string;
}

export interface SqliteTaskStorageOperationalState {
  schemaVersion: number;
  journalMode: string;
  busyTimeoutMs: number;
  indexes: readonly string[];
}

export function validatePersistedTaskArtifact(
  artifact: PersistedTaskArtifact,
): PersistedTaskArtifact {
  if (!artifact.taskId.trim() || !artifact.artifactId.trim() || !artifact.tenantId.trim()) {
    throw new Error('Artifact taskId, artifactId, and tenantId are required');
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.checksumSha256)) {
    throw new Error('Artifact checksumSha256 must be a SHA-256 hex digest');
  }
  if (!/^[\w.+-]+\/[\w.+-]+(?:\s*;.*)?$/i.test(artifact.contentType)) {
    throw new Error('Artifact contentType must be a valid media type');
  }
  if (
    artifact.sizeBytes !== undefined &&
    (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)
  ) {
    throw new Error('Artifact sizeBytes must be a non-negative integer');
  }
  if (artifact.provenance.taskId !== artifact.taskId || !artifact.provenance.producerId.trim()) {
    throw new Error('Artifact provenance must identify the same task and a producer');
  }
  if (artifact.sensitivity === 'secret' && !artifact.redacted) {
    throw new Error('Secret artifacts must be redacted before persistence');
  }
  const payloadUrl = parsePayloadReference(artifact.payloadRef);
  if (payloadUrl.username || payloadUrl.password || payloadUrl.search || payloadUrl.hash) {
    throw new Error('Artifact payloadRef must not contain credentials, query data, or fragments');
  }
  return structuredClone(artifact);
}

function parsePayloadReference(value: string): URL {
  try {
    const parsed = new URL(value);
    if (!['https:', 's3:', 'gs:', 'file:'].includes(parsed.protocol)) {
      throw new Error('unsupported scheme');
    }
    return parsed;
  } catch (error) {
    throw new Error('Artifact payloadRef must be an approved absolute reference', { cause: error });
  }
}
