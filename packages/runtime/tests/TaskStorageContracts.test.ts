import { describe, expect, it } from 'vitest';
import {
  validatePersistedTaskArtifact,
  type PersistedTaskArtifact,
} from '../src/storage/TaskStorageContracts.js';

function artifact(overrides: Partial<PersistedTaskArtifact> = {}): PersistedTaskArtifact {
  return {
    taskId: 'task-1',
    artifactId: 'artifact-1',
    tenantId: 'tenant-a',
    contentType: 'text/plain',
    checksumSha256: 'a'.repeat(64),
    payloadRef: 'file:///var/lib/a2amesh/task-1/artifact-1.txt',
    sensitivity: 'internal',
    redacted: false,
    provenance: { producerId: 'worker-1', taskId: 'task-1' },
    createdAt: '2026-07-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('validatePersistedTaskArtifact', () => {
  it('accepts a well-formed artifact and returns a defensive clone', () => {
    const input = artifact();
    const result = validatePersistedTaskArtifact(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('rejects a blank taskId, artifactId, or tenantId', () => {
    expect(() => validatePersistedTaskArtifact(artifact({ taskId: '  ' }))).toThrow(
      'taskId, artifactId, and tenantId are required',
    );
    expect(() => validatePersistedTaskArtifact(artifact({ artifactId: '' }))).toThrow(
      'taskId, artifactId, and tenantId are required',
    );
    expect(() => validatePersistedTaskArtifact(artifact({ tenantId: '' }))).toThrow(
      'taskId, artifactId, and tenantId are required',
    );
  });

  it('rejects a contentType that is not a valid media type', () => {
    expect(() =>
      validatePersistedTaskArtifact(artifact({ contentType: 'not-a-media-type' })),
    ).toThrow('must be a valid media type');
  });

  it('rejects a negative or non-integer sizeBytes', () => {
    expect(() => validatePersistedTaskArtifact(artifact({ sizeBytes: -1 }))).toThrow(
      'must be a non-negative integer',
    );
    expect(() => validatePersistedTaskArtifact(artifact({ sizeBytes: 1.5 }))).toThrow(
      'must be a non-negative integer',
    );
    expect(() => validatePersistedTaskArtifact(artifact({ sizeBytes: 42 }))).not.toThrow();
  });

  it('rejects provenance that does not identify the same task and a producer', () => {
    expect(() =>
      validatePersistedTaskArtifact(
        artifact({ provenance: { producerId: 'worker-1', taskId: 'other-task' } }),
      ),
    ).toThrow('must identify the same task and a producer');
    expect(() =>
      validatePersistedTaskArtifact(
        artifact({ provenance: { producerId: '  ', taskId: 'task-1' } }),
      ),
    ).toThrow('must identify the same task and a producer');
  });

  it('rejects a payloadRef with an unsupported scheme', () => {
    expect(() =>
      validatePersistedTaskArtifact(artifact({ payloadRef: 'ftp://example.com/artifact.txt' })),
    ).toThrow('approved absolute reference');
  });

  it('rejects a payloadRef that is not a parseable URL', () => {
    expect(() => validatePersistedTaskArtifact(artifact({ payloadRef: 'not a url' }))).toThrow(
      'approved absolute reference',
    );
  });
});
