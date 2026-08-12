import { createHash } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type McpToolCaller = Pick<Client, 'callTool'>;

export type McpToolInvocationReasonCode =
  | 'mcp-tool-not-allowed'
  | 'mcp-input-invalid'
  | 'mcp-input-too-large'
  | 'mcp-operation-timeout'
  | 'mcp-operation-cancelled'
  | 'mcp-operation-failed'
  | 'mcp-result-invalid'
  | 'mcp-result-too-large'
  | 'mcp-audit-failed';

export interface McpToolInvocationAuditEvent {
  timestamp: string;
  tool: string;
  outcome: 'denied' | 'succeeded' | 'failed';
  reasonCode: McpToolInvocationReasonCode | 'mcp-operation-succeeded';
  inputHash: string;
  outputHash?: string | undefined;
}

export interface McpToolInvocationOptions {
  client: McpToolCaller;
  tool: string;
  input?: Record<string, unknown> | undefined;
  allowedTools: readonly string[];
  timeoutMs?: number | undefined;
  maxInputBytes?: number | undefined;
  maxResultBytes?: number | undefined;
  signal?: AbortSignal | undefined;
  audit?: ((event: McpToolInvocationAuditEvent) => void | Promise<void>) | undefined;
}

export class McpToolInvocationError extends Error {
  constructor(readonly reasonCode: McpToolInvocationReasonCode) {
    super(reasonCode);
    this.name = 'McpToolInvocationError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function boundedInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}

function isJsonValue(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value as Record<string, unknown>).every((entry) =>
      isJsonValue(entry, seen),
    );
  } finally {
    seen.delete(value);
  }
}

function safeInputHash(input: unknown): string {
  try {
    return hash(JSON.stringify(input ?? {}));
  } catch {
    const kind = Array.isArray(input) ? 'array' : input === null ? 'null' : typeof input;
    return hash(`invalid-input:${kind}`);
  }
}

function error(reasonCode: McpToolInvocationReasonCode): McpToolInvocationError {
  return new McpToolInvocationError(reasonCode);
}

async function emitAudit(
  options: McpToolInvocationOptions,
  event: Omit<McpToolInvocationAuditEvent, 'timestamp' | 'tool'>,
): Promise<void> {
  if (!options.audit) return;
  try {
    await options.audit({
      timestamp: new Date().toISOString(),
      tool: options.tool,
      ...event,
    });
  } catch {
    throw error('mcp-audit-failed');
  }
}

async function fail(
  options: McpToolInvocationOptions,
  reasonCode: McpToolInvocationReasonCode,
  outcome: 'denied' | 'failed',
  inputHash: string,
): Promise<never> {
  await emitAudit(options, { outcome, reasonCode, inputHash });
  throw error(reasonCode);
}

async function callWithDeadline(
  options: McpToolInvocationOptions,
  input: Record<string, unknown>,
): Promise<unknown> {
  const timeoutMs = boundedInteger(options.timeoutMs, 5_000);
  if (options.signal?.aborted) throw error('mcp-operation-cancelled');

  const timeoutController = new AbortController();
  let abortReason: 'mcp-operation-timeout' | 'mcp-operation-cancelled' | undefined;
  const onParentAbort = (): void => {
    abortReason ??= 'mcp-operation-cancelled';
  };
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    abortReason ??= 'mcp-operation-timeout';
    timeoutController.abort(new Error('operation timeout'));
  }, timeoutMs);

  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const operation = Promise.resolve().then(() =>
    options.client.callTool({ name: options.tool, arguments: input }, undefined, { signal }),
  );
  void operation.catch(() => undefined);
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectForAbort = (): void => reject(error(abortReason ?? 'mcp-operation-cancelled'));
    if (signal.aborted) rejectForAbort();
    else signal.addEventListener('abort', rejectForAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } catch (caught) {
    if (caught instanceof McpToolInvocationError) throw caught;
    throw error(abortReason ?? 'mcp-operation-failed');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

function encodeValidatedResult(result: unknown): { result: CallToolResult; encoded: string } {
  const parsed = CallToolResultSchema.safeParse(result);
  if (!parsed.success) throw error('mcp-result-invalid');
  try {
    return { result: parsed.data, encoded: JSON.stringify(parsed.data) };
  } catch {
    throw error('mcp-result-invalid');
  }
}

export async function invokeMcpTool(options: McpToolInvocationOptions): Promise<CallToolResult> {
  const input = options.input ?? {};
  const inputHash = safeInputHash(input);

  if (!options.tool.trim() || !options.allowedTools.includes(options.tool)) {
    return fail(options, 'mcp-tool-not-allowed', 'denied', inputHash);
  }
  if (!isJsonValue(input, new WeakSet<object>()) || Array.isArray(input)) {
    return fail(options, 'mcp-input-invalid', 'denied', inputHash);
  }

  let encodedInput: string;
  try {
    encodedInput = JSON.stringify(input);
  } catch {
    return fail(options, 'mcp-input-invalid', 'denied', inputHash);
  }
  if (Buffer.byteLength(encodedInput, 'utf8') > boundedInteger(options.maxInputBytes, 32_768)) {
    return fail(options, 'mcp-input-too-large', 'denied', inputHash);
  }

  let rawResult: unknown;
  try {
    rawResult = await callWithDeadline(options, input);
  } catch (caught) {
    const reasonCode = reasonFromOperationError(caught);
    return fail(options, reasonCode, 'failed', inputHash);
  }
  let validated: { result: CallToolResult; encoded: string };
  try {
    validated = encodeValidatedResult(rawResult);
  } catch {
    return fail(options, 'mcp-result-invalid', 'failed', inputHash);
  }
  if (
    Buffer.byteLength(validated.encoded, 'utf8') > boundedInteger(options.maxResultBytes, 65_536)
  ) {
    return fail(options, 'mcp-result-too-large', 'failed', inputHash);
  }

  await emitAudit(options, {
    outcome: 'succeeded',
    reasonCode: 'mcp-operation-succeeded',
    inputHash,
    outputHash: hash(validated.encoded),
  });
  return validated.result;
}

function reasonFromOperationError(caught: unknown): McpToolInvocationReasonCode {
  if (caught instanceof McpToolInvocationError) {
    if (
      caught.reasonCode === 'mcp-operation-timeout' ||
      caught.reasonCode === 'mcp-operation-cancelled'
    ) {
      return caught.reasonCode;
    }
  }
  return 'mcp-operation-failed';
}
