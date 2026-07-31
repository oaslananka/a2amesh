import { randomUUID } from 'node:crypto';
import {
  A2AClient,
  createAuthenticatingFetchWithRetry,
  createOutboundPolicyFetch,
  validateUrl,
  type OutboundPolicyOptions,
  type Task,
} from '@a2amesh/runtime';
import type {
  OpenClawMcpAgentConfig,
  OpenClawMcpBridgeOptions,
  OpenClawMcpOperations,
} from './types.js';

export class OpenClawBridgeOperationError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
  }
}

export function redactOpenClawOutput(value: string, secrets: readonly string[]): string {
  let result = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(api[_-]?key|token|client[_-]?secret|secret|password)=([^&\s,;"}]+)/gi,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replace(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
  for (const secret of secrets) {
    if (secret.length >= 4) result = result.split(secret).join('[REDACTED]');
  }
  return result.length > 8_192 ? `${result.slice(0, 8_192)}…` : result;
}

function taskOutput(task: Task, secrets: readonly string[]): string {
  const values = (task.artifacts ?? []).flatMap((artifact) =>
    artifact.parts.map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'data') return JSON.stringify(part.data);
      return '[Binary file omitted]';
    }),
  );
  return redactOpenClawOutput(values.join('\n\n'), secrets);
}

export function createOpenClawTaskSummary(
  task: Task,
  secrets: readonly string[],
): Record<string, unknown> {
  return {
    id: redactOpenClawOutput(String(task.id ?? ''), secrets),
    state: redactOpenClawOutput(String(task.status?.state ?? 'UNKNOWN'), secrets),
    ...(task.contextId ? { contextId: redactOpenClawOutput(String(task.contextId), secrets) } : {}),
    output: taskOutput(task, secrets),
  };
}

function mergeSignals(primary: AbortSignal, secondary?: AbortSignal | null): AbortSignal {
  return secondary ? AbortSignal.any([primary, secondary]) : primary;
}

export function createDefaultOpenClawOperations(
  options: OpenClawMcpBridgeOptions,
): OpenClawMcpOperations {
  const timeoutMs = options.operationTimeoutMs ?? 30_000;
  const outboundPolicy: OutboundPolicyOptions = {
    timeoutMs,
    maxResponseBytes: 2 * 1024 * 1024,
    ...(options.outboundPolicy ?? {}),
  };

  function clientFor(agent: OpenClawMcpAgentConfig, signal: AbortSignal): A2AClient {
    const policyFetch = createOutboundPolicyFetch(outboundPolicy);
    const scopedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      policyFetch(input, {
        ...(init ?? {}),
        signal: mergeSignals(signal, init?.signal),
      })) as typeof fetch;
    const fetchImplementation = agent.token
      ? createAuthenticatingFetchWithRetry(scopedFetch, {
          async headers() {
            return { Authorization: `Bearer ${agent.token}` };
          },
        })
      : scopedFetch;
    return new A2AClient(agent.url, {
      fetchImplementation,
      retry: { maxAttempts: 1, backoffMs: 0, retryOn: [] },
    });
  }

  async function validateAgent(agent: OpenClawMcpAgentConfig): Promise<void> {
    try {
      await validateUrl(agent.url, outboundPolicy);
    } catch {
      throw new OpenClawBridgeOperationError('mcp-outbound-policy-denied');
    }
  }

  return {
    async sendMessage({ agent, message, contextId, signal }) {
      await validateAgent(agent);
      return clientFor(agent, signal).sendMessage({
        message: {
          role: 'user',
          parts: [{ type: 'text', text: message }],
          messageId: `openclaw-mcp-${randomUUID()}`,
          timestamp: new Date().toISOString(),
        },
        ...(contextId ? { contextId } : {}),
      });
    },
    async getTask({ agent, taskId, signal }) {
      await validateAgent(agent);
      return clientFor(agent, signal).getTask(taskId);
    },
  };
}

export async function runBoundedOpenClawOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error('operation timeout')),
    timeoutMs,
  );
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutController.signal])
    : timeoutController.signal;

  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectForAbort = (): void => reject(signal.reason ?? new Error('operation aborted'));
    if (signal.aborted) rejectForAbort();
    else signal.addEventListener('abort', rejectForAbort, { once: true });
  });
  const work = Promise.resolve().then(() => operation(signal));
  void work.catch(() => undefined);

  try {
    return await Promise.race([work, abortPromise]);
  } catch (error: unknown) {
    if (parentSignal?.aborted) {
      throw new OpenClawBridgeOperationError('mcp-operation-cancelled');
    }
    if (timeoutController.signal.aborted) {
      throw new OpenClawBridgeOperationError('mcp-operation-timeout');
    }
    if (error instanceof OpenClawBridgeOperationError) throw error;
    throw new OpenClawBridgeOperationError('mcp-operation-failed');
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveOpenClawAgent(
  options: OpenClawMcpBridgeOptions,
  tenantId: string,
  agentId: string,
): OpenClawMcpAgentConfig | undefined {
  return options.agents.find(
    (agent) =>
      agent.id === agentId && agent.tenantId === tenantId && tenantId === options.expectedTenantId,
  );
}
