import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FleetArtifactValidationError,
  MAX_INLINE_CONTENT_BYTES,
  validateFleetArtifact,
  type FleetArtifactRecord,
} from '../src/artifact-contracts/FleetArtifacts.js';

function record(overrides: Partial<FleetArtifactRecord> = {}): FleetArtifactRecord {
  return {
    artifactId: 'artifact-1',
    kind: 'diff',
    taskId: 'task-1',
    contentType: 'text/x-diff',
    sensitivity: 'internal',
    redacted: false,
    provenance: { producerId: 'worker-1', taskId: 'task-1' },
    createdAt: '2026-07-03T00:00:00.000Z',
    content: 'diff --git a/file b/file\n+added line\n',
    ...overrides,
  };
}

function recordWithoutContent(
  overrides: Partial<Omit<FleetArtifactRecord, 'content'>> = {},
): FleetArtifactRecord {
  return {
    artifactId: 'artifact-1',
    kind: 'diff',
    taskId: 'task-1',
    contentType: 'text/x-diff',
    sensitivity: 'internal',
    redacted: false,
    provenance: { producerId: 'worker-1', taskId: 'task-1' },
    createdAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateFleetArtifact', () => {
  it('accepts a well-formed inline artifact and returns a defensive clone', () => {
    const input = record();
    const validated = validateFleetArtifact(input);
    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
  });

  it('accepts every standardized artifact kind', () => {
    const kinds: FleetArtifactRecord['kind'][] = [
      'plan',
      'diff',
      'patch',
      'file-change-summary',
      'command-log',
      'test-output',
      'review-comment',
      'security-finding',
      'pr-metadata',
      'release-evidence',
    ];
    for (const kind of kinds) {
      expect(() => validateFleetArtifact(record({ kind }))).not.toThrow();
    }
  });

  it('rejects an unknown artifact kind', () => {
    expect(() =>
      validateFleetArtifact(record({ kind: 'unknown-kind' as FleetArtifactRecord['kind'] })),
    ).toThrow(FleetArtifactValidationError);
  });

  it('rejects provenance whose taskId does not match the artifact taskId', () => {
    expect(() =>
      validateFleetArtifact(
        record({ provenance: { producerId: 'worker-1', taskId: 'other-task' } }),
      ),
    ).toThrow('provenance.taskId must match');
  });

  it('requires either content or payloadRef, and rejects both together', () => {
    expect(() => validateFleetArtifact(recordWithoutContent())).toThrow('must set either content');
    expect(() =>
      validateFleetArtifact(record({ payloadRef: 'https://artifacts.example.com/a.diff' })),
    ).toThrow('must not set both');
  });

  it('rejects inline content over the size limit', () => {
    expect(() =>
      validateFleetArtifact(record({ content: 'x'.repeat(MAX_INLINE_CONTENT_BYTES + 1) })),
    ).toThrow('exceeding the');
  });

  it('validates the checksum when provided and rejects a mismatch', () => {
    const content = 'diff --git a/file b/file\n';
    const checksum = createHash('sha256').update(content, 'utf8').digest('hex');
    expect(() =>
      validateFleetArtifact(record({ content, checksumSha256: checksum })),
    ).not.toThrow();
    expect(() =>
      validateFleetArtifact(record({ content, checksumSha256: 'a'.repeat(64) })),
    ).toThrow('does not match');
  });

  it('rejects credential-shaped content unless redacted', () => {
    expect(() =>
      validateFleetArtifact(
        record({ kind: 'command-log', content: 'export API_KEY=sk-live-abcdef123456' }),
      ),
    ).toThrow('credential-like material');
    expect(() =>
      validateFleetArtifact(
        record({
          kind: 'command-log',
          content: 'export API_KEY=[REDACTED]',
          redacted: true,
        }),
      ),
    ).not.toThrow();
  });

  it('requires restricted-sensitivity artifacts to be redacted', () => {
    expect(() =>
      validateFleetArtifact(record({ sensitivity: 'restricted', redacted: false })),
    ).toThrow('must be redacted');
    expect(() =>
      validateFleetArtifact(record({ sensitivity: 'restricted', redacted: true })),
    ).not.toThrow();
  });

  it('validates payloadRef scheme and rejects embedded credentials', () => {
    expect(() =>
      validateFleetArtifact(
        recordWithoutContent({ payloadRef: 'ftp://artifacts.example.com/a.diff' }),
      ),
    ).toThrow('is not permitted');
    expect(() =>
      validateFleetArtifact(
        recordWithoutContent({
          payloadRef: 'https://user:pass@artifacts.example.com/a.diff',
        }),
      ),
    ).toThrow('must not embed credentials');
    expect(() =>
      validateFleetArtifact(
        recordWithoutContent({ payloadRef: 'https://artifacts.example.com/a.diff' }),
      ),
    ).not.toThrow();
  });

  it('captures full provenance fields', () => {
    const validated = validateFleetArtifact(
      record({
        provenance: {
          producerId: 'worker-1',
          taskId: 'task-1',
          runId: 'run-1',
          workspace: 'a2amesh',
          branch: 'main',
          commit: 'abc123',
          commandHash: 'deadbeef',
        },
      }),
    );
    expect(validated.provenance).toEqual(
      expect.objectContaining({ runId: 'run-1', workspace: 'a2amesh', branch: 'main' }),
    );
  });
});
