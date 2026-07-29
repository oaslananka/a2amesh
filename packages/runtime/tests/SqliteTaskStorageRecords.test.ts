import { describe, expect, it } from 'vitest';
import {
  mapArtifactRow,
  mapAuditRow,
  parsePushNotification,
  parsePushNotificationConfigs,
  parseTask,
  pushNotificationConfigId,
  serializePushNotificationConfigs,
  type ArtifactRow,
  type AuditRow,
} from '../src/storage/SqliteTaskStorageRecords.js';
import type { PushNotificationConfig, Task } from '../src/types/task.js';

const task: Task = {
  kind: 'task',
  id: 'task-1',
  contextId: 'context-1',
  status: { state: 'SUBMITTED', timestamp: '2026-07-03T12:00:00.000Z' },
  history: [],
  artifacts: [],
  extensions: [],
};

describe('SQLite task-storage record codecs', () => {
  it('parses task rows without sharing mutable state', () => {
    const parsed = parseTask({ task_json: JSON.stringify(task) });

    expect(parsed).toEqual(task);
    expect(parsed).not.toBe(task);
    expect(parseTask(undefined)).toBeUndefined();
  });

  it('normalizes legacy and collection push-notification records', () => {
    const legacy: PushNotificationConfig = { url: 'https://example.test/push' };
    const parsedLegacy = parsePushNotificationConfigs({ config_json: JSON.stringify(legacy) });

    expect(parsedLegacy).toEqual(
      new Map([['default', { id: 'default', url: 'https://example.test/push' }]]),
    );
    expect(parsePushNotification({ config_json: JSON.stringify(legacy) })).toEqual({
      id: 'default',
      url: 'https://example.test/push',
    });

    const configs = new Map<string, PushNotificationConfig>([
      ['secondary', { id: 'secondary', url: 'https://example.test/secondary' }],
      ['default', { id: 'default', url: 'https://example.test/default' }],
    ]);
    const serialized = serializePushNotificationConfigs(configs);
    const reparsed = parsePushNotificationConfigs({ config_json: serialized });

    expect(reparsed).toEqual(configs);
    expect(reparsed.get('default')).not.toBe(configs.get('default'));
    expect(parsePushNotification({ config_json: serialized })).toEqual(configs.get('default'));
  });

  it('maps audit and artifact rows to domain contracts', () => {
    const auditRow: AuditRow = {
      sequence: 7,
      task_id: 'task-1',
      tenant_id: 'tenant-a',
      principal_id: null,
      action: 'task.saved',
      outcome: 'success',
      timestamp: '2026-07-03T12:00:00.000Z',
      correlation_id: 'correlation-1',
    };
    expect(mapAuditRow(auditRow)).toEqual({
      sequence: 7,
      taskId: 'task-1',
      tenantId: 'tenant-a',
      action: 'task.saved',
      outcome: 'success',
      timestamp: '2026-07-03T12:00:00.000Z',
      correlationId: 'correlation-1',
    });

    const artifactRow: ArtifactRow = {
      task_id: 'task-1',
      artifact_id: 'artifact-1',
      tenant_id: 'tenant-a',
      content_type: 'text/plain',
      checksum_sha256: 'a'.repeat(64),
      payload_ref: 'file:///var/lib/a2amesh/task-1/artifact-1.txt',
      size_bytes: null,
      sensitivity: 'internal',
      redacted: 1,
      provenance_json: JSON.stringify({ producerId: 'worker-1', taskId: 'task-1' }),
      created_at: '2026-07-03T12:00:00.000Z',
    };
    expect(mapArtifactRow(artifactRow)).toEqual({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      tenantId: 'tenant-a',
      contentType: 'text/plain',
      checksumSha256: 'a'.repeat(64),
      payloadRef: 'file:///var/lib/a2amesh/task-1/artifact-1.txt',
      sensitivity: 'internal',
      redacted: true,
      provenance: { producerId: 'worker-1', taskId: 'task-1' },
      createdAt: '2026-07-03T12:00:00.000Z',
    });
  });

  it('uses a stable default identifier for empty push-notification ids', () => {
    expect(pushNotificationConfigId({ url: 'https://example.test/push' })).toBe('default');
    expect(pushNotificationConfigId({ id: '  custom  ', url: 'https://example.test/push' })).toBe(
      'custom',
    );
  });
});
