import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FetchIdleTimeoutError,
  FetchRedirectError,
  FetchResponseLimitError,
  FetchSseLimitError,
  fetchWithPolicy,
  readSseData,
  redactHeaders,
} from '../src/net/fetchWithPolicy.js';
import { redactUrl } from '../src/utils/redaction.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env['LOG_LEVEL'];
});

describe('outbound redaction', () => {
  it('redacts sensitive headers and URL query strings', () => {
    const redacted = redactHeaders({
      Authorization: 'Bearer token',
      'X-API-KEY': 'secret',
      'Content-Type': 'application/json',
    });

    expect(redacted['Authorization']).toBe('[REDACTED]');
    expect(redacted['X-API-KEY']).toBe('[REDACTED]');
    expect(redacted['Content-Type']).toBe('application/json');
    expect(redactUrl('https://example.com/path?token=secret#fragment')).toBe(
      'https://example.com/path?[REDACTED]',
    );
  });

  it('does not emit query secrets in debug logs', async () => {
    process.env['LOG_LEVEL'] = 'debug';
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const response = await fetchWithPolicy('https://example.com/data?token=top-secret');
    await response.text();

    expect(output).not.toContain('top-secret');
    expect(output).toContain('[REDACTED]');
  });
});

describe('fetchWithPolicy retries', () => {
  it('succeeds on the first attempt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const response = await fetchWithPolicy('http://test');

    await expect(response.text()).resolves.toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transient responses', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('not found', { status: 404 }));

    const response = await fetchWithPolicy('http://test', {}, { retries: 3 });

    expect(response.status).toBe(404);
    await response.text();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries idempotent requests on transient responses', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithPolicy(
      'http://test',
      {},
      { retries: 3, backoffBaseMs: 10, jitter: false },
    );
    await vi.advanceTimersByTimeAsync(50);
    const response = await promise;

    await expect(response.text()).resolves.toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry POST without an explicit idempotency policy', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('error', { status: 503 }));

    const response = await fetchWithPolicy(
      'http://test',
      { method: 'POST', body: 'payload' },
      { retries: 2, backoffBaseMs: 0 },
    );

    expect(response.status).toBe(503);
    await response.text();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries POST when an idempotency key is present', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));

    const promise = fetchWithPolicy(
      'http://test',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'task-1' },
        body: 'payload',
      },
      { retries: 1, backoffBaseMs: 1, jitter: false },
    );
    await vi.advanceTimersByTimeAsync(5);
    const response = await promise;

    await expect(response.text()).resolves.toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects redirects when no validating outbound resolver is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1' } }),
    );

    await expect(fetchWithPolicy('https://example.com')).rejects.toBeInstanceOf(FetchRedirectError);
  });
});

describe('fetchWithPolicy response limits', () => {
  it('propagates RequestInit abort signals through the policy lifecycle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
          },
        }),
      ),
    );
    const controller = new AbortController();
    const response = await fetchWithPolicy(
      'https://example.com/abort',
      { signal: controller.signal },
      { timeoutMs: 1_000 },
    );

    controller.abort(new Error('caller aborted'));

    await expect(response.text()).rejects.toThrow('caller aborted');
  });

  it('keeps the total deadline active during slow body consumption', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
          },
        }),
      ),
    );

    const response = await fetchWithPolicy('https://example.com/slow', {}, { timeoutMs: 20 });

    await expect(response.text()).rejects.toThrow('timed out');
  });

  it('rejects a declared content length above the configured limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('small', { headers: { 'Content-Length': '100' } }),
    );

    await expect(
      fetchWithPolicy('https://example.com/large', {}, { maxResponseBytes: 10 }),
    ).rejects.toBeInstanceOf(FetchResponseLimitError);
  });

  it('rejects streamed bodies before unbounded buffering', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('123456'));

    const response = await fetchWithPolicy(
      'https://example.com/large',
      {},
      { maxResponseBytes: 5 },
    );

    await expect(response.text()).rejects.toBeInstanceOf(FetchResponseLimitError);
  });

  it('rejects oversized JSON responses before JSON parsing can buffer them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ value: '1234567890' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await fetchWithPolicy('https://example.com/data', {}, { maxResponseBytes: 8 });

    await expect(response.json()).rejects.toBeInstanceOf(FetchResponseLimitError);
  });

  it('enforces SSE event, line, and event-buffer limits', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('data: one\n\ndata: two\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('data: 123456\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('data: 1234\ndata: 5678\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

    const tooMany = await fetchWithPolicy('https://example.com/events', {}, { maxSseEvents: 1 });
    await expect(tooMany.text()).rejects.toBeInstanceOf(FetchSseLimitError);

    const longLine = await fetchWithPolicy(
      'https://example.com/events',
      {},
      { maxSseLineBytes: 5 },
    );
    await expect(longLine.text()).rejects.toBeInstanceOf(FetchSseLimitError);

    const largeEvent = await fetchWithPolicy(
      'https://example.com/events',
      {},
      { maxSseBufferBytes: 12 },
    );
    await expect(largeEvent.text()).rejects.toBeInstanceOf(FetchSseLimitError);
  });

  it('reads fragmented SSE data from a policy-bounded response', async () => {
    const encoder = new TextEncoder();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: first\r\n\r\ndata: sec'));
            controller.enqueue(encoder.encode('ond\n\nignored: value\n'));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    const response = await fetchWithPolicy('https://example.com/events');

    await expect(readSseData(response)).resolves.toEqual(['first', 'second']);
  });

  it('aborts an idle SSE response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Deliberately never emits or closes.
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    const response = await fetchWithPolicy(
      'https://example.com/events',
      {},
      { timeoutMs: 1_000, sseIdleTimeoutMs: 20 },
    );

    await expect(response.text()).rejects.toBeInstanceOf(FetchIdleTimeoutError);
  });
});
