import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateAndFetch } from '../src/net/OutboundPolicy.js';
import { PushNotificationService } from '../src/server/PushNotificationService.js';
import type { Task } from '../src/types/task.js';
import type * as OutboundPolicyModule from '../src/net/OutboundPolicy.js';

vi.mock('../src/net/OutboundPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof OutboundPolicyModule>();
  return {
    ...actual,
    validateAndFetch: vi.fn(),
  };
});

const validateAndFetchMock = vi.mocked(validateAndFetch);

describe('PushNotificationService', () => {
  afterEach(() => {
    vi.useRealTimers();
    validateAndFetchMock.mockReset();
  });

  it('sends notification with default and auth headers', async () => {
    const service = new PushNotificationService();
    validateAndFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await service.sendNotification(
      {
        url: 'https://example.com/webhook',
        token: 'secret',
        authentication: { type: 'http', id: 'bearer', scheme: 'bearer' },
      },
      {
        id: 'task-1',
        status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
        history: [],
      } as Task,
    );

    expect(validateAndFetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'task-1',
          'X-A2A-Notification-Token': 'secret',
          Authorization: 'Bearer secret',
        }),
      }),
      expect.objectContaining({
        retries: 0,
        timeoutMs: 10000,
        telemetryLabels: expect.objectContaining({
          'a2a.outbound.operation': 'push-notification',
        }),
      }),
    );
  });

  it('retries with exponential backoff', async () => {
    const service = new PushNotificationService();
    const fn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValueOnce();

    await service.retryWithBackoff(fn, 3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('supports apiKey query delivery', async () => {
    const service = new PushNotificationService();
    validateAndFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await service.sendNotification(
      {
        url: 'https://example.com/webhook',
        token: 'secret',
        authentication: { type: 'apiKey', id: 'key', in: 'query', name: 'api_key' },
      },
      {
        id: 'task-1',
        status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
        history: [],
      } as Task,
    );

    expect(validateAndFetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook?api_key=secret',
      expect.any(Object),
      expect.objectContaining({ retries: 0, timeoutMs: 10000 }),
    );
  });

  it('supports apiKey header delivery and openIdConnect bearer delivery', async () => {
    const service = new PushNotificationService();
    validateAndFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const task = {
      id: 'task-1',
      status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
      history: [],
    } as Task;

    await service.sendNotification(
      {
        url: 'https://example.com/header',
        token: 'header-secret',
        authentication: { type: 'apiKey', id: 'key', in: 'header', name: 'x-api-key' },
      },
      task,
    );
    await service.sendNotification(
      {
        url: 'https://example.com/oidc',
        token: 'oidc-secret',
        authentication: {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://issuer.example/.well-known/openid-configuration',
        },
      },
      task,
    );

    expect(validateAndFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/header',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'task-1',
          'X-A2A-Notification-Token': 'header-secret',
          'x-api-key': 'header-secret',
        }),
      }),
      expect.objectContaining({ retries: 0, timeoutMs: 10000 }),
    );
    expect(validateAndFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/oidc',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oidc-secret',
        }),
      }),
      expect.objectContaining({ retries: 0, timeoutMs: 10000 }),
    );
  });

  it('throws when webhook delivery fails and when retries are exhausted', async () => {
    const service = new PushNotificationService();
    validateAndFetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      service.sendNotification(
        {
          url: 'https://example.com/webhook',
        },
        {
          id: 'task-1',
          status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
          history: [],
        } as Task,
      ),
    ).rejects.toThrow('Push notification failed: HTTP 500');

    const failingOperation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('still failing'));
    await expect(service.retryWithBackoff(failingOperation, 2)).rejects.toThrow('still failing');
    expect(failingOperation).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit after repeated failures and skips delivery while open', async () => {
    const service = new PushNotificationService({
      circuitBreaker: {
        failureThreshold: 2,
        recoveryTimeoutMs: 1000,
        successThreshold: 1,
      },
    });
    validateAndFetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    const task = {
      id: 'task-1',
      status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
      history: [],
    } as Task;

    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).rejects.toThrow();
    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).rejects.toThrow();
    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).resolves.toBeUndefined();

    expect(validateAndFetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers after the circuit timeout and allows successful delivery', async () => {
    vi.useFakeTimers();
    const service = new PushNotificationService({
      circuitBreaker: {
        failureThreshold: 1,
        recoveryTimeoutMs: 10_000,
        successThreshold: 1,
      },
    });
    const task = {
      id: 'task-1',
      status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
      history: [],
    } as Task;

    validateAndFetchMock
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).rejects.toThrow();
    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).resolves.toBeUndefined();
    expect(validateAndFetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_001);

    await expect(
      service.sendNotification({ url: 'https://example.com/webhook' }, task),
    ).resolves.toBeUndefined();
    expect(validateAndFetchMock).toHaveBeenCalledTimes(2);
  });
});
