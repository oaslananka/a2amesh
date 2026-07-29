import type { PushNotificationConfig, Task } from '../types/task.js';
import type { PersistedTaskArtifact, TaskAuditEntry } from './TaskStorageContracts.js';

export interface TaskRow {
  task_json: string;
  tenant_id?: string;
  status?: string;
  updated_at?: string;
  expires_at?: string | null;
}

export interface PushNotificationRow {
  config_json: string;
}

interface PushNotificationCollection {
  configs: Record<string, PushNotificationConfig>;
}

export interface CountRow {
  count: number;
}

export interface PragmaValueRow {
  journal_mode?: string;
  timeout?: number;
}

export interface IndexRow {
  name: string;
}

export interface AuditRow {
  sequence: number;
  task_id: string;
  tenant_id: string;
  principal_id: string | null;
  action: string;
  outcome: TaskAuditEntry['outcome'];
  timestamp: string;
  correlation_id: string | null;
}

export interface ArtifactRow {
  task_id: string;
  artifact_id: string;
  tenant_id: string;
  content_type: string;
  checksum_sha256: string;
  payload_ref: string;
  size_bytes: number | null;
  sensitivity: PersistedTaskArtifact['sensitivity'];
  redacted: number;
  provenance_json: string;
  created_at: string;
}

export const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

export function parseTask(row: TaskRow | undefined): Task | undefined {
  return row ? (JSON.parse(row.task_json) as Task) : undefined;
}

export function parsePushNotification(
  row: PushNotificationRow | undefined,
): PushNotificationConfig | undefined {
  if (!row) {
    return undefined;
  }
  const configs = parsePushNotificationConfigs(row);
  return configs.get(DEFAULT_PUSH_NOTIFICATION_CONFIG_ID) ?? configs.values().next().value;
}

export function parsePushNotificationConfigs(
  row: PushNotificationRow | undefined,
): Map<string, PushNotificationConfig> {
  if (!row) {
    return new Map();
  }

  const parsed = JSON.parse(row.config_json) as PushNotificationConfig | PushNotificationCollection;
  if (isPushNotificationCollection(parsed)) {
    return new Map(
      Object.entries(parsed.configs).map(([id, config]) => [id, structuredClone(config)]),
    );
  }

  const id = pushNotificationConfigId(parsed);
  return new Map([[id, { ...parsed, id }]]);
}

export function serializePushNotificationConfigs(
  configs: Map<string, PushNotificationConfig>,
): string {
  return JSON.stringify({
    configs: Object.fromEntries(configs),
  } satisfies PushNotificationCollection);
}

export function mapAuditRow(row: AuditRow): TaskAuditEntry {
  return {
    sequence: row.sequence,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    action: row.action,
    outcome: row.outcome,
    timestamp: row.timestamp,
    ...(row.principal_id ? { principalId: row.principal_id } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
  };
}

export function mapArtifactRow(row: ArtifactRow): PersistedTaskArtifact {
  return {
    taskId: row.task_id,
    artifactId: row.artifact_id,
    tenantId: row.tenant_id,
    contentType: row.content_type,
    checksumSha256: row.checksum_sha256,
    payloadRef: row.payload_ref,
    sensitivity: row.sensitivity,
    redacted: row.redacted === 1,
    provenance: JSON.parse(row.provenance_json) as PersistedTaskArtifact['provenance'],
    createdAt: row.created_at,
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
  };
}

export function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}

function isPushNotificationCollection(value: unknown): value is PushNotificationCollection {
  return (
    value !== null &&
    typeof value === 'object' &&
    'configs' in value &&
    (value as PushNotificationCollection).configs !== null &&
    typeof (value as PushNotificationCollection).configs === 'object'
  );
}
