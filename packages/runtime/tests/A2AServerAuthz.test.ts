import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { A2AServer } from '../src/server/A2AServer.js';
import type { AgentCard, TaskManager } from '../src/index.js';
import type { Artifact, Message, Task } from '../src/types/task.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';

const mockCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'Test',
  description: 'Test',
  version: '1.0',
  url: 'http://test',
};

class TestServer extends A2AServer {
  constructor() {
    super(mockCard, {
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: {
          'api-key': [
            { value: 'key-a-tenant-1', principalId: 'user-A', tenantId: 'tenant-1' },
            { value: 'key-a-tenant-2', principalId: 'user-A', tenantId: 'tenant-2' },
            { value: 'key-b-tenant-1', principalId: 'user-B', tenantId: 'tenant-1' },
          ],
        },
      },
    });
  }

  override async handleTask(_task: Task, _message: Message): Promise<Artifact[]> {
    return [];
  }

  getApp() {
    return this.app;
  }
  override getTaskManager(): TaskManager {
    return this.taskManager;
  }
}

describe('A2AServer Authorization', () => {
  it("prevents a user from getting another user's task", async () => {
    const server = new TestServer();
    const taskManager = server.getTaskManager();

    const task = taskManager.createTask('sess', 'ctx', 'user-A', 'tenant-1');

    const getRes1 = await request(server.getApp())
      .post('/')
      .set('x-api-key', 'key-b-tenant-1')
      .send({ jsonrpc: '2.0', method: 'tasks/get', params: { taskId: task.id }, id: 1 });

    expect(getRes1.body.error.message).toBe('Unauthorized task access');

    const getRes2 = await request(server.getApp())
      .post('/')
      .set('x-api-key', 'key-a-tenant-1')
      .send({ jsonrpc: '2.0', method: 'tasks/get', params: { taskId: task.id }, id: 2 });

    expect(getRes2.body.result.id).toBe(task.id);
  });

  it('filters task list by principal and tenant', async () => {
    const server = new TestServer();
    const taskManager = server.getTaskManager();

    taskManager.createTask('sess1', 'ctx', 'user-A', 'tenant-1');
    taskManager.createTask('sess2', 'ctx', 'user-A', 'tenant-2');
    taskManager.createTask('sess3', 'ctx', 'user-B', 'tenant-1');

    const listRes = await request(server.getApp())
      .post('/')
      .set('x-api-key', 'key-a-tenant-1')
      .send({ jsonrpc: '2.0', method: 'tasks/list', params: {}, id: 1 });

    expect(listRes.body.result.tasks).toHaveLength(1);
    expect(listRes.body.result.tasks[0].principalId).toBe('user-A');
    expect(listRes.body.result.tasks[0].tenantId).toBe('tenant-1');
  });


  it('denies authenticated access to legacy tasks without complete ownership metadata', async () => {
    const server = new TestServer();
    const taskManager = server.getTaskManager();

    const unscopedTask = taskManager.createTask('legacy-session', 'legacy-context');
    const tenantOnlyTask = taskManager.createTask('tenant-only-session', 'legacy-context', undefined, 'tenant-1');
    const ownerOnlyTask = taskManager.createTask('owner-only-session', 'legacy-context', 'user-A');

    for (const task of [unscopedTask, tenantOnlyTask, ownerOnlyTask]) {
      const response = await request(server.getApp())
        .post('/')
        .set('x-api-key', 'key-a-tenant-1')
        .send({ jsonrpc: '2.0', method: 'tasks/get', params: { taskId: task.id }, id: task.id });

      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: ErrorCodes.Unauthorized,
          message: 'Unauthorized task access',
        }),
      );
    }
  });

  it('omits unowned tasks from authenticated task lists by default', async () => {
    const server = new TestServer();
    const taskManager = server.getTaskManager();

    taskManager.createTask('owned-session', 'ctx', 'user-A', 'tenant-1');
    taskManager.createTask('legacy-session', 'ctx');
    taskManager.createTask('tenant-only-session', 'ctx', undefined, 'tenant-1');
    taskManager.createTask('owner-only-session', 'ctx', 'user-A');
    taskManager.createTask('cross-tenant-session', 'ctx', 'user-A', 'tenant-2');
    taskManager.createTask('cross-owner-session', 'ctx', 'user-B', 'tenant-1');

    const response = await request(server.getApp())
      .post('/')
      .set('x-api-key', 'key-a-tenant-1')
      .send({ jsonrpc: '2.0', method: 'tasks/list', params: { contextId: 'ctx' }, id: 1 });

    expect(response.body.result.tasks).toEqual([
      expect.objectContaining({ principalId: 'user-A', tenantId: 'tenant-1' }),
    ]);
    expect(response.body.result.total).toBe(1);
  });

  it('binds REST tenant aliases to authenticated tenant context', async () => {
    const server = new TestServer();

    const sendRes = await request(server.getApp())
      .post('/tenant-1/message:send')
      .set('x-api-key', 'key-a-tenant-1')
      .send({
        message: {
          role: 'user',
          messageId: 'rest-tenant-message',
          timestamp: new Date().toISOString(),
          parts: [{ type: 'text', text: 'hello tenant route' }],
        },
      });

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.tenantId).toBe('tenant-1');

    const listRes = await request(server.getApp())
      .get('/tenant-1/tasks')
      .set('x-api-key', 'key-a-tenant-1');

    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([
      expect.objectContaining({
        id: sendRes.body.id,
        tenantId: 'tenant-1',
        principalId: 'user-A',
      }),
    ]);
  });

  it('rejects REST tenant aliases that do not match authenticated tenant', async () => {
    const server = new TestServer();

    const response = await request(server.getApp())
      .post('/tenant-2/message:send')
      .set('x-api-key', 'key-a-tenant-1')
      .send({
        message: {
          role: 'user',
          messageId: 'rest-tenant-mismatch',
          timestamp: new Date().toISOString(),
          parts: [{ type: 'text', text: 'wrong tenant route' }],
        },
      });

    expect(response.status).toBe(403);
    expect(response.header['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'https://a2a-protocol.org/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Tenant path does not match authenticated tenant',
        code: ErrorCodes.Unauthorized,
      }),
    );
    expect(response.body.data[0].metadata).toEqual(
      expect.objectContaining({
        requestedTenantId: 'tenant-2',
        authenticatedTenantId: 'tenant-1',
      }),
    );
  });
});
