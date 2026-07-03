import { createHash } from 'node:crypto';
import type { FleetArtifactSensitivity } from '../types/domain.js';

/**
 * Standardized coding-agent artifact kinds (#92). Every artifact a Local
 * Agent Mesh worker returns must declare one of these so downstream
 * consumers (humans, CI, release automation, other agents) can route and
 * render it without vendor-specific parsing.
 */
export type FleetArtifactKind =
  | 'plan'
  | 'diff'
  | 'patch'
  | 'file-change-summary'
  | 'command-log'
  | 'test-output'
  | 'review-comment'
  | 'security-finding'
  | 'pr-metadata'
  | 'release-evidence';

export interface FleetArtifactProvenance {
  /** Worker/adapter id that produced this artifact. */
  producerId: string;
  taskId: string;
  runId?: string;
  workspace?: string;
  branch?: string;
  commit?: string;
  commandHash?: string;
}

export interface FleetArtifactRecord {
  artifactId: string;
  kind: FleetArtifactKind;
  taskId: string;
  contentType: string;
  sensitivity: FleetArtifactSensitivity;
  redacted: boolean;
  provenance: FleetArtifactProvenance;
  createdAt: string;
  /** Inline payload for small artifacts (bounded by `MAX_INLINE_CONTENT_BYTES`). */
  content?: string;
  /** Reference to out-of-band storage for large payloads. Mutually exclusive-in-practice with `content`. */
  payloadRef?: string;
  sizeBytes?: number;
  checksumSha256?: string;
}

const KNOWN_KINDS: ReadonlySet<FleetArtifactKind> = new Set([
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
]);

export const MAX_INLINE_CONTENT_BYTES = 200_000;

const CREDENTIAL_PATTERN =
  /(?:bearer\s+[a-z0-9._-]{10,}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export class FleetArtifactValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FleetArtifactValidationError';
  }
}

/**
 * Validates an artifact against the Local Agent Mesh contract: known kind,
 * consistent provenance, a bounded/checksummed payload, and mandatory
 * redaction before anything sensitive or credential-shaped is accepted.
 * Throws `FleetArtifactValidationError` with a specific, actionable message
 * on any violation; returns a defensive clone on success.
 */
export function validateFleetArtifact(artifact: FleetArtifactRecord): FleetArtifactRecord {
  if (!KNOWN_KINDS.has(artifact.kind)) {
    throw new FleetArtifactValidationError(
      `Unknown Fleet artifact kind "${artifact.kind}"; expected one of ${[...KNOWN_KINDS].join(', ')}`,
    );
  }
  if (!artifact.artifactId.trim() || !artifact.taskId.trim()) {
    throw new FleetArtifactValidationError('Fleet artifact requires artifactId and taskId');
  }
  if (!artifact.provenance.producerId.trim()) {
    throw new FleetArtifactValidationError('Fleet artifact provenance requires producerId');
  }
  if (artifact.provenance.taskId !== artifact.taskId) {
    throw new FleetArtifactValidationError(
      'Fleet artifact provenance.taskId must match the artifact taskId',
    );
  }
  if (!artifact.content && !artifact.payloadRef) {
    throw new FleetArtifactValidationError(
      'Fleet artifact must set either content (inline) or payloadRef (out-of-band)',
    );
  }
  if (artifact.content && artifact.payloadRef) {
    throw new FleetArtifactValidationError(
      'Fleet artifact must not set both content and payloadRef',
    );
  }

  if (artifact.content) {
    const byteLength = Buffer.byteLength(artifact.content, 'utf8');
    if (byteLength > MAX_INLINE_CONTENT_BYTES) {
      throw new FleetArtifactValidationError(
        `Fleet artifact inline content is ${byteLength} bytes, exceeding the ${MAX_INLINE_CONTENT_BYTES}-byte limit; use payloadRef instead`,
      );
    }
    if (artifact.checksumSha256) {
      const computed = createHash('sha256').update(artifact.content, 'utf8').digest('hex');
      if (computed.toLowerCase() !== artifact.checksumSha256.toLowerCase()) {
        throw new FleetArtifactValidationError(
          'Fleet artifact checksumSha256 does not match the provided content',
        );
      }
    }
    if (CREDENTIAL_PATTERN.test(artifact.content) && !artifact.redacted) {
      throw new FleetArtifactValidationError(
        'Fleet artifact content appears to contain credential-like material and must be redacted before persistence',
      );
    }
  }

  if (artifact.payloadRef) {
    let parsed: URL;
    try {
      parsed = new URL(artifact.payloadRef);
    } catch (error) {
      throw new FleetArtifactValidationError(
        'Fleet artifact payloadRef must be an absolute reference URL',
        { cause: error },
      );
    }
    if (!['https:', 's3:', 'gs:', 'file:'].includes(parsed.protocol)) {
      throw new FleetArtifactValidationError(
        `Fleet artifact payloadRef scheme "${parsed.protocol}" is not permitted`,
      );
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new FleetArtifactValidationError(
        'Fleet artifact payloadRef must not embed credentials, query data, or a fragment',
      );
    }
  }

  if (artifact.sensitivity === 'restricted' && !artifact.redacted) {
    throw new FleetArtifactValidationError(
      'Fleet artifact with sensitivity "restricted" must be redacted before persistence',
    );
  }

  if (
    artifact.sizeBytes !== undefined &&
    (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)
  ) {
    throw new FleetArtifactValidationError(
      'Fleet artifact sizeBytes must be a non-negative integer',
    );
  }

  return structuredClone(artifact);
}
