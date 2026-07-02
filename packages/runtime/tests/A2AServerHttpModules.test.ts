import { describe, expect, it } from 'vitest';
import { AGENT_CARD_PATHS, JSON_RPC_PATHS } from '../src/server/http/routes.js';
import { isOriginAllowed } from '../src/server/http/middleware.js';
import {
  buildIdempotencyScope,
  decorateIdempotentResult,
  extractJsonRpcId,
  isIdempotentMethod,
} from '../src/server/http/idempotency.js';
import {
  createJsonRpcErrorResponse,
  createJsonRpcSuccessResponse,
} from '../src/server/http/jsonRpcHandler.js';
import { isStreamingRpcMethod, STREAM_PATHS } from '../src/server/http/streamRoutes.js';
import { buildHealthResponse } from '../src/server/http/metricsRoutes.js';
import { normalizePushNotificationConfig } from '../src/server/http/pushCallbacks.js';
import {
  isTerminalTaskState,
  toLifecycleJsonRpcError,
} from '../src/server/http/lifecycleErrors.js';
import { TaskLifecycleError } from '../src/server/TaskManager.js';
import { ErrorCodes, JsonRpcError } from '../src/types/jsonrpc.js';
import type { AgentCard } from '../src/types/agent-card.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'HTTP Module Harness',
  description: 'HTTP module test harness',
  url: 'http://localhost:0',
  version: '1.2.3',
};

describe('A2AServer HTTP module helpers', () => {
  it('declares canonical route aliases', () => {
    expect(AGENT_CARD_PATHS).toEqual(['/.well-known/agent-card.json', '/.well-known/agent.json']);
    expect(JSON_RPC_PATHS).toEqual(['/', '/rpc', '/a2a/jsonrpc']);
    expect(STREAM_PATHS).toEqual(['/stream', '/a2a/stream']);
    expect(isStreamingRpcMethod('message/stream')).toBe(true);
    expect(isStreamingRpcMethod('tasks/get')).toBe(false);
  });

  it('validates exact and wildcard origins', () => {
    expect(
      isOriginAllowed({
        origin: 'https://app.example.com',
        allowedOrigins: ['https://app.example.com'],
        requireOrigin: true,
      }),
    ).toBe(true);
    expect(
      isOriginAllowed({
        origin: 'https://api.example.com',
        allowedOrigins: ['*.example.com'],
        requireOrigin: true,
      }),
    ).toBe(true);
    expect(
      isOriginAllowed({
        origin: 'https://example.com',
        allowedOrigins: ['*.example.com'],
        requireOrigin: true,
      }),
    ).toBe(true);
    expect(
      isOriginAllowed({
        origin: undefined,
        allowedOrigins: ['https://app.example.com'],
        requireOrigin: true,
      }),
    ).toBe(false);
  });

  it('builds JSON-RPC envelopes and preserves valid request ids', () => {
    expect(createJsonRpcSuccessResponse({ ok: true }, 0)).toEqual({
      jsonrpc: '2.0',
      result: { ok: true },
      id: 0,
    });
    expect(
      createJsonRpcErrorResponse(new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found'), ''),
    ).toEqual({
      jsonrpc: '2.0',
      error: { code: ErrorCodes.TaskNotFound, message: 'Task not found' },
      id: '',
    });
    expect(extractJsonRpcId({ id: false })).toBeNull();
    expect(extractJsonRpcId({ id: 0 })).toBe(0);
  });

  it('decorates idempotent object results without changing primitive results', () => {
    const idempotency = {
      key: 'idem-key',
      scope: 'rpc:message/send:global:principal:apiKey',
      fingerprint: 'fingerprint',
    };

    expect(isIdempotentMethod('message/send')).toBe(true);
    expect(isIdempotentMethod('tasks/get')).toBe(false);
    expect(decorateIdempotentResult('unchanged', idempotency, true)).toBe('unchanged');
    expect(
      decorateIdempotentResult({ id: 'task-1', metadata: { existing: true } }, idempotency, true),
    ).toEqual({
      id: 'task-1',
      metadata: {
        existing: true,
        idempotency: {
          key: 'idem-key',
          scope: 'rpc:message/send:global:principal:apiKey',
          fingerprint: 'fingerprint',
          replayed: true,
        },
      },
    });

    expect(
      buildIdempotencyScope({
        method: 'tasks/cancel',
        tenantId: 'tenant-a',
        principalId: 'principal-a',
        authMethod: 'apiKey',
      }),
    ).toBe('rpc:tasks/cancel:tenant-a:principal-a:apiKey');
  });

  it('builds health responses from injected runtime state', () => {
    const payload = buildHealthResponse({
      agentCard,
      now: 1_700_000_010_000,
      startedAt: 1_700_000_000_000,
      taskCounts: {
        active: 2,
        canceled: 0,
        rejected: 0,
        completed: 3,
        failed: 1,
        inputRequired: 0,
        authRequired: 0,
        queued: 0,
        submitted: 0,
        total: 6,
        waitingOnExternal: 0,
        working: 2,
      },
      memoryUsage: {
        heapUsed: 12.5 * 1024 * 1024,
        heapTotal: 64 * 1024 * 1024,
      },
    });

    expect(payload).toMatchObject({
      status: 'healthy',
      version: '1.2.3',
      protocol: 'A2A/1.0',
      uptime: 10,
      tasks: { active: 2, completed: 3, failed: 1, total: 6 },
      memory: { heapUsedMb: 12.5, heapTotalMb: 64 },
    });
  });

  it('builds production-safe health responses without detailed memory values', () => {
    const payload = buildHealthResponse({
      agentCard,
      now: 1_700_000_010_000,
      startedAt: 1_700_000_000_000,
      detailLevel: 'safe',
      taskCounts: {
        active: 2,
        canceled: 0,
        rejected: 0,
        completed: 3,
        failed: 1,
        inputRequired: 0,
        authRequired: 0,
        queued: 0,
        submitted: 0,
        total: 6,
        waitingOnExternal: 0,
        working: 2,
      },
      memoryUsage: {
        heapUsed: 12.5 * 1024 * 1024,
        heapTotal: 64 * 1024 * 1024,
      },
    });

    expect(payload).toMatchObject({
      status: 'healthy',
      version: '1.2.3',
      protocol: 'A2A/1.0',
      uptime: 10,
      tasks: { active: 2, completed: 3, failed: 1, total: 6 },
      memory: { heapUsedMb: 0, heapTotalMb: 0 },
    });
  });

  it('uses environment-driven health detail defaults', () => {
    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const payload = buildHealthResponse({
        agentCard,
        now: 1_700_000_010_000,
        startedAt: 1_700_000_000_000,
        taskCounts: {
          active: 0,
          canceled: 0,
          rejected: 0,
          completed: 0,
          failed: 0,
          inputRequired: 0,
          authRequired: 0,
          queued: 0,
          submitted: 0,
          total: 0,
          waitingOnExternal: 0,
          working: 0,
        },
        memoryUsage: { heapUsed: 10 * 1024 * 1024, heapTotal: 20 * 1024 * 1024 },
      });
      expect(payload.memory).toEqual({ heapUsedMb: 0, heapTotalMb: 0 });
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = previousNodeEnv;
      }
    }
  });

  it('normalizes safe push notification configs and maps lifecycle errors', async () => {
    await expect(
      normalizePushNotificationConfig(
        { url: 'https://example.com/hook', token: 'token-a' },
        { allowedHostnames: ['example.com'] },
      ),
    ).resolves.toEqual({ url: 'https://example.com/hook', token: 'token-a' });

    await expect(
      normalizePushNotificationConfig({ url: 'http://127.0.0.1/hook' }, {}),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: expect.stringContaining('Invalid push notification URL'),
    });

    expect(isTerminalTaskState('COMPLETED')).toBe(true);
    expect(isTerminalTaskState('WORKING')).toBe(false);
    expect(
      toLifecycleJsonRpcError(
        new TaskLifecycleError(
          'INVALID_TASK_TRANSITION',
          'bad transition',
          'task-1',
          'COMPLETED',
          'WORKING',
        ),
      ),
    ).toMatchObject({
      code: ErrorCodes.InvalidTaskTransition,
      data: [
        {
          reason: 'INVALID_TASK_TRANSITION',
          metadata: {
            taskId: 'task-1',
            currentState: 'COMPLETED',
            nextState: 'WORKING',
          },
        },
      ],
    });
  });
});
