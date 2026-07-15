export interface ResponseLimitOptions {
  maxResponseBytes: number;
  maxSseEvents: number;
  maxSseLineBytes: number;
  maxSseBufferBytes: number;
  sseIdleTimeoutMs: number;
  signal: AbortSignal;
  abort(reason: Error): void;
  onError?(error: Error): void;
  finalize(): void | Promise<void>;
}

export class FetchResponseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchResponseLimitError';
  }
}

export class FetchSseLimitError extends FetchResponseLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'FetchSseLimitError';
  }
}

export class FetchIdleTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchIdleTimeoutError';
  }
}

export async function wrapResponseWithLimits(
  response: Response,
  options: ResponseLimitOptions,
): Promise<Response> {
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength !== undefined && declaredLength > options.maxResponseBytes) {
    const error = new FetchResponseLimitError(
      `Response content-length ${declaredLength} exceeds limit ${options.maxResponseBytes}`,
    );
    options.onError?.(error);
    await response.body?.cancel();
    await options.finalize();
    throw error;
  }

  if (!response.body) {
    await options.finalize();
    return response;
  }

  const isSse = (response.headers.get('content-type') ?? '')
    .toLowerCase()
    .includes('text/event-stream');
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error: unknown) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    options.onError?.(normalized);
    await options.finalize();
    throw normalized;
  }
  let totalBytes = 0;
  let lineBytes = 0;
  let eventBytes = 0;
  let eventCount = 0;
  let eventHasContent = false;
  let previousByte: number | undefined;
  let finalized = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let errorReported = false;

  const reportErrorOnce = (error: Error): void => {
    if (errorReported) return;
    errorReported = true;
    options.onError?.(error);
  };

  const finalizeOnce = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    if (idleTimer) clearTimeout(idleTimer);
    options.signal.removeEventListener('abort', handleAbort);
    await options.finalize();
  };

  const handleAbort = (): void => {
    reportErrorOnce(abortReason(options.signal));
    void reader
      .cancel(options.signal.reason)
      .catch(() => undefined)
      .then(() => finalizeOnce())
      .catch(() => undefined);
  };

  const resetIdleTimer = (): void => {
    if (!isSse || options.sseIdleTimeoutMs <= 0 || finalized) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      options.abort(
        new FetchIdleTimeoutError(
          `SSE stream was idle for more than ${options.sseIdleTimeoutMs}ms`,
        ),
      );
    }, options.sseIdleTimeoutMs);
  };

  options.signal.addEventListener('abort', handleAbort, { once: true });
  resetIdleTimer();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (options.signal.aborted) {
          throw abortReason(options.signal);
        }

        const { value, done } = await reader.read();
        if (options.signal.aborted) {
          throw abortReason(options.signal);
        }
        if (done) {
          if (isSse && (eventHasContent || lineBytes > 0)) {
            eventCount += 1;
            assertSseEventCount(eventCount, options.maxSseEvents);
          }
          controller.close();
          await finalizeOnce();
          return;
        }

        if (!value) return;
        totalBytes += value.byteLength;
        if (totalBytes > options.maxResponseBytes) {
          throw new FetchResponseLimitError(
            `Response body exceeds limit ${options.maxResponseBytes} bytes`,
          );
        }

        if (isSse) {
          inspectSseChunk(value);
          resetIdleTimer();
        }

        controller.enqueue(value);
      } catch (error: unknown) {
        const normalized = normalizeStreamError(error, options.signal);
        reportErrorOnce(normalized);
        options.abort(normalized);
        await reader.cancel(normalized).catch(() => undefined);
        controller.error(normalized);
        await finalizeOnce();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await finalizeOnce();
    },
  });

  return copyResponse(response, stream);

  function inspectSseChunk(chunk: Uint8Array): void {
    for (const byte of chunk) {
      eventBytes += 1;
      if (eventBytes > options.maxSseBufferBytes) {
        throw new FetchSseLimitError(
          `SSE event buffer exceeds limit ${options.maxSseBufferBytes} bytes`,
        );
      }

      if (byte === 10) {
        const blankLine = lineBytes === 0 || (lineBytes === 1 && previousByte === 13);
        if (blankLine) {
          if (eventHasContent) {
            eventCount += 1;
            assertSseEventCount(eventCount, options.maxSseEvents);
          }
          eventBytes = 0;
          eventHasContent = false;
        } else {
          eventHasContent = true;
        }
        lineBytes = 0;
      } else {
        lineBytes += 1;
        if (lineBytes > options.maxSseLineBytes) {
          throw new FetchSseLimitError(`SSE line exceeds limit ${options.maxSseLineBytes} bytes`);
        }
      }
      previousByte = byte;
    }
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertSseEventCount(count: number, maxEvents: number): void {
  if (count > maxEvents) {
    throw new FetchSseLimitError(`SSE event count exceeds limit ${maxEvents}`);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function normalizeStreamError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted && signal.reason instanceof Error) return signal.reason;
  return error instanceof Error ? error : new Error(String(error));
}

function copyResponse(response: Response, body: ReadableStream<Uint8Array>): Response {
  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  for (const [key, value] of [
    ['url', response.url],
    ['redirected', response.redirected],
    ['type', response.type],
  ] as const) {
    Object.defineProperty(wrapped, key, { value, configurable: true });
  }

  return wrapped;
}

/** Reads SSE data fields from an already policy-bounded response body. */
export async function readSseData(response: Response): Promise<string[]> {
  if (!response.body) {
    throw new Error('SSE response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const data: string[] = [];
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    if (done) buffer += decoder.decode();

    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() ?? '');
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data:')) continue;
      const value = line.slice('data:'.length);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }

    if (done) break;
  }

  if (buffer) {
    const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
    if (line.startsWith('data:')) {
      const value = line.slice('data:'.length);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  return data;
}
