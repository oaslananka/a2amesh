/**
 * @file redaction.ts
 * Default-on redaction of secret-shaped content recorded into a cassette.
 * This mirrors the "credential-shaped content" heuristic already used for
 * Fleet artifact validation, reimplemented locally so `packages/runtime`
 * does not take a new dependency on `@a2amesh/internal-fleet`.
 */

import type { ExtensibleArtifact, Message, Task } from '../../types/task.js';

const REDACTED_PLACEHOLDER = '[REDACTED]';

const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
  /bearer\s+[a-z0-9._-]{10,}/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token)["'\s:=]+[a-z0-9._-]{16,}/gi,
];

export function redactSecretShapedText(value: string): string {
  return SECRET_SHAPED_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, REDACTED_PLACEHOLDER),
    value,
  );
}

type MessagePart = Message['parts'][number];

function redactPart(part: MessagePart): MessagePart {
  if (part.type === 'text') {
    return { ...part, text: redactSecretShapedText(part.text) };
  }
  if (part.type === 'data') {
    return { ...part, data: redactRecord(part.data) };
  }
  return part;
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, redactUnknownValue(value)]),
  );
}

function redactUnknownValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretShapedText(value);
  if (Array.isArray(value)) return value.map(redactUnknownValue);
  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>);
  }
  return value;
}

function redactMessage(message: Message): Message {
  return { ...message, parts: message.parts.map(redactPart) };
}

function redactArtifact(artifact: ExtensibleArtifact): ExtensibleArtifact {
  return {
    ...artifact,
    parts: artifact.parts.map(redactPart),
    ...(artifact.metadata ? { metadata: redactRecord(artifact.metadata) } : {}),
  };
}

/**
 * Returns a deep copy of `task` with every message part, artifact part, and
 * artifact metadata value passed through `redactSecretShapedText`. Task
 * identifiers, status, and timestamps are left untouched — only user/agent
 * authored content can carry secret-shaped values.
 */
export function redactTask(task: Task): Task {
  return {
    ...task,
    history: task.history.map(redactMessage),
    ...(task.artifacts ? { artifacts: task.artifacts.map(redactArtifact) } : {}),
  };
}
