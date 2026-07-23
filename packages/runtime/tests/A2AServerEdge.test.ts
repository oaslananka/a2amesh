import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { A2AServer, type A2AServerOptions } from '../src/server/A2AServer.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';
import type { AgentCard } from '../src/types/agent-card.js';
import type { Artifact, Message, Task } from '../src/types/task.js';
import { logger } from '../src/utils/logger.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'Edge Harness Agent',
  description: 'A2AServer edge-case test harness',
  url: 'http://localhost:0',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: true,
    stateTransitionHistory: true,
    extendedAgentCard: true,
  },
};

class EdgeHarnessServer extends A2AServer {
  constructor(options: A2AServerOptions = {}) {
    super(agentCard, options);
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = message.parts.find((part) => part.type === 'text');

    return [
      {
        artifactId: 'artifact-1',
        index: 0,
        lastChunk: true,
        parts: [
          {
            type: 'text',
            text: text?.type === 'text' ? `echo:${text.text}` : 'echo:',
          },
        ],
      },
    ];
  }
}

class GatedIdempotencyServer extends EdgeHarnessServer {
  handleTaskCalls = 0;
  private releaseTask!: () => void;
  private resolveTaskStarted!: () => void;
  readonly taskStarted = new Promise<void>((resolve) => {
    this.resolveTaskStarted = resolve;
  });
  private readonly taskGate = new Promise<void>((resolve) => {
    this.releaseTask = resolve;
  });

  release(): void {
    this.releaseTask();
  }

  override async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    this.handleTaskCalls += 1;
    this.resolveTaskStarted();
    await this.taskGate;
    return super.handleTask(task, message);
  }
}

function createMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: `message-${text}`,
    timestamp: new Date().toISOString(),
  };
}

describe('A2AServer edge cases', () => {
  it('returns 429 when the JSON-RPC rate limit is exceeded', async () => {
    const server = new EdgeHarnessServer({
      rateLimit: { maxRequests: 2, windowMs: 60_000 },
    });

    const payload = {
      jsonrpc: '2.0' as const,
      method: 'message/send',
      params: { message: createMessage('rate-limit') },
    };

    await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '1' })
      .expect(200);
    await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '2' })
      .expect(200);

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '3' });

    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({
      code: ErrorCodes.RateLimitExceeded,
      message: 'Too Many Requests',
    });
  });

  it('applies a default rate limiter to HTTP routes', async () => {
    const server = new EdgeHarnessServer();

    const response = await request(server.getExpressApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.header['x-ratelimit-limit']).toBe('100');
    expect(response.header['x-ratelimit-remaining']).toBe('99');
    expect(response.header['x-ratelimit-reset']).toMatch(/^\d+$/);
  });

  it('counts malformed JSON requests against the default rate limiter', async () => {
    const server = new EdgeHarnessServer({
      rateLimit: { maxRequests: 1, windowMs: 60_000 },
    });

    const parseResponse = await request(server.getExpressApp())
      .post('/rpc')
      .type('json')
      .send('{"jsonrpc":')
      .expect(200);

    expect(parseResponse.body.error).toMatchObject({
      code: ErrorCodes.ParseError,
      message: 'Parse error',
    });

    const response = await request(server.getExpressApp()).get('/health');

    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({
      code: ErrorCodes.RateLimitExceeded,
      message: 'Too Many Requests',
    });
  });

  it('returns 401 for protected endpoints when auth headers are missing', async () => {
    const server = new EdgeHarnessServer({
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: { 'api-key': 'secret' },
      },
    });

    const response = await request(server.getExpressApp()).get('/tasks');

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('returns 403 when a task stream is accessed from a different tenant', async () => {
    const server = new EdgeHarnessServer({
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: {
          'api-key': [
            { value: 'key-a', principalId: 'user-a', tenantId: 'tenant-1' },
            { value: 'key-a-tenant-2', principalId: 'user-a', tenantId: 'tenant-2' },
          ],
        },
      },
    });
    const task = server
      .getTaskManager()
      .createTask('session-edge', 'context-edge', 'user-a', 'tenant-1');

    const response = await request(server.getExpressApp())
      .get('/stream')
      .query({ taskId: task.id })
      .set('x-api-key', 'key-a-tenant-2');

    expect(response.status).toBe(403);
    expect(response.text).toBe('Forbidden');
  });

  it('returns a JSON-RPC TaskNotFound error envelope from the /rpc alias', async () => {
    const server = new EdgeHarnessServer();

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'missing-task',
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });

    expect(response.status).toBe(200);
    expect(response.body.error).toMatchObject({
      code: ErrorCodes.TaskNotFound,
      message: 'Task not found',
    });
  });

  it('rejects JSON-RPC batch arrays before method dispatch', async () => {
    const server = new EdgeHarnessServer();

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send([
        {
          jsonrpc: '2.0',
          id: 'batch-message',
          method: 'message/send',
          params: { message: createMessage('batch') },
        },
      ]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: expect.objectContaining({
        code: ErrorCodes.InvalidRequest,
        message: 'Batch requests are not supported',
      }),
      id: null,
    });
    expect(server.getTaskManager().getAllTasks()).toHaveLength(0);
  });

  it('preserves falsy JSON-RPC ids and returns protocol parse errors for invalid JSON', async () => {
    const server = new EdgeHarnessServer();

    const numericId = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });
    expect(numericId.status).toBe(200);
    expect(numericId.body.id).toBe(0);
    expect(numericId.body.error.code).toBe(ErrorCodes.TaskNotFound);

    const emptyStringId = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: '',
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });
    expect(emptyStringId.status).toBe(200);
    expect(emptyStringId.body.id).toBe('');

    const parseError = await request(server.getExpressApp())
      .post('/rpc')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":"2.0","id":0,');
    expect(parseError.status).toBe(200);
    expect(parseError.body).toEqual({
      jsonrpc: '2.0',
      error: {
        code: ErrorCodes.ParseError,
        message: 'Parse error',
        data: [
          expect.objectContaining({
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'PARSE_ERROR',
            domain: 'a2a-protocol.org',
          }),
        ],
      },
      id: null,
    });
  });

  it('streams canonical JSON-RPC SSE responses for message/stream and tasks/resubscribe', async () => {
    const server = new EdgeHarnessServer();
    const message = createMessage('canonical-stream');

    const streamResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .set('Idempotency-Key', 'canonical-stream-key')
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'message/stream',
        params: { message },
      });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.header['content-type']).toContain('text/event-stream');
    expect(streamResponse.text).toContain('"jsonrpc":"2.0"');
    expect(streamResponse.text).toContain('"id":0');
    expect(streamResponse.text).toContain('"state":"COMPLETED"');

    const taskId = /"id":"([^"]+)"/.exec(streamResponse.text)?.[1];
    expect(taskId).toBeDefined();

    const resubscribeResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: '',
        method: 'tasks/resubscribe',
        params: { taskId },
      });

    expect(resubscribeResponse.status).toBe(200);
    expect(resubscribeResponse.header['content-type']).toContain('text/event-stream');
    expect(resubscribeResponse.text).toContain('"id":""');
    expect(resubscribeResponse.text).toContain('"state":"COMPLETED"');

    const replayResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .set('Idempotency-Key', 'canonical-stream-key')
      .send({
        jsonrpc: '2.0',
        id: 'replay-stream',
        method: 'message/stream',
        params: { message },
      });

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.header['content-type']).toContain('text/event-stream');
    expect(replayResponse.text).toContain(`"id":"${taskId}"`);
    expect(replayResponse.text).toContain('"key":"canonical-stream-key"');
    expect(replayResponse.text).toContain('"replayed":true');
  });

  it('rejects push notification webhook URLs that resolve to private networks', async () => {
    const server = new EdgeHarnessServer();
    const task = server.getTaskManager().createTask('session-ssrf', 'context-ssrf');

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'push-block',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: task.id,
          pushNotificationConfig: {
            url: 'http://169.254.169.254/hook',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.error.code).toBe(ErrorCodes.InvalidParams);
    expect(response.body.error.message).toContain('Invalid push notification URL');
    expect(response.body.error.message).toContain('Private IP addresses are not allowed');
  });

  it('replays idempotent task creation requests and rejects conflicting payloads', async () => {
    const server = new EdgeHarnessServer();
    const payload = {
      jsonrpc: '2.0',
      id: 'idempotency-1',
      method: 'message/send',
      params: {
        message: createMessage('idempotent request'),
      },
    };

    const first = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'create-task-1')
      .send(payload);
    const second = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'create-task-1')
      .send({ ...payload, id: 'idempotency-2' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.result.id).toBe(first.body.result.id);
    expect(second.body.result.metadata.idempotency).toMatchObject({
      key: 'create-task-1',
      replayed: true,
    });

    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const conflict = await request(server.getExpressApp())
        .post('/rpc')
        .set('Idempotency-Key', 'create-task-1')
        .send({
          ...payload,
          id: 'idempotency-3',
          params: {
            message: createMessage('different body'),
          },
        });

      expect(conflict.status).toBe(200);
      expect(conflict.body.error.code).toBe(ErrorCodes.IdempotencyConflict);
      expect(warning).toHaveBeenCalledWith('Idempotency reservation conflict', {
        method: 'message/send',
        outcome: 'conflict',
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain('create-task-1');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('different body');
    } finally {
      warning.mockRestore();
    }
  });

  it('exposes runtime metrics and rejects invalid terminal transitions', async () => {
    const server = new EdgeHarnessServer();

    const created = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'task-for-metrics',
        method: 'message/send',
        params: {
          message: createMessage('metrics please'),
        },
      });
    expect(created.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const cancelPayload = {
      jsonrpc: '2.0' as const,
      method: 'tasks/cancel',
      params: {
        taskId: created.body.result.id,
      },
    };
    const cancelResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'cancel-terminal-key')
      .send({ ...cancelPayload, id: 'cancel-terminal' });

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.error.code).toBe(ErrorCodes.InvalidTaskTransition);

    const replayedCancel = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'cancel-terminal-key')
      .send({ ...cancelPayload, id: 'cancel-terminal-replay' });
    expect(replayedCancel.status).toBe(200);
    expect(replayedCancel.body.error).toMatchObject(cancelResponse.body.error);
    expect(replayedCancel.body.id).toBe('cancel-terminal-replay');

    const metricsResponse = await request(server.getExpressApp()).get('/metrics');
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain('a2a_runtime_task_created_total');
    expect(metricsResponse.text).toContain('a2a_runtime_task_completed_total');
    expect(metricsResponse.text).toContain('a2a_runtime_tasks_active');
  });

  it('treats REST push notification config delete as idempotent', async () => {
    const server = new EdgeHarnessServer();
    const task = server.getTaskManager().createTask('session-push-delete', 'context-push-delete');

    const first = await request(server.getExpressApp()).delete(
      `/tasks/${task.id}/pushNotificationConfigs/missing-config`,
    );
    const second = await request(server.getExpressApp()).delete(
      `/tasks/${task.id}/pushNotificationConfigs/missing-config`,
    );

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });
  it('executes one side effect for concurrent identical idempotency keys', async () => {
    const server = new GatedIdempotencyServer({ idempotencyLeaseMs: 5_000 });
    const payload = {
      jsonrpc: '2.0' as const,
      method: 'message/send',
      params: { message: createMessage('concurrent-idempotency') },
    };

    const firstPromise = request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'concurrent-key')
      .send({ ...payload, id: 'first' })
      .then((response) => response);

    const firstState = await Promise.race([
      server.taskStarted.then(() => ({ state: 'started' as const })),
      firstPromise.then((response) => ({ state: 'completed' as const, response })),
    ]);
    expect(firstState).toEqual({ state: 'started' });

    let second;
    try {
      second = await request(server.getExpressApp())
        .post('/rpc')
        .set('Idempotency-Key', 'concurrent-key')
        .send({ ...payload, id: 'second' });

      expect(second.status).toBe(200);
      expect(second.body.error).toMatchObject({
        code: ErrorCodes.IdempotencyInProgress,
        message: 'Idempotent request is already in progress',
      });
      expect(server.handleTaskCalls).toBe(1);
      expect(server.getTaskManager().getAllTasks()).toHaveLength(1);
    } finally {
      server.release();
    }
    const first = await firstPromise;
    expect(first.body.result.metadata.idempotency.replayed).toBe(false);

    const replay = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'concurrent-key')
      .send({ ...payload, id: 'replay' });
    expect(replay.body.result.id).toBe(first.body.result.id);
    expect(replay.body.result.metadata.idempotency.replayed).toBe(true);
    expect(server.handleTaskCalls).toBe(1);
  });
});
