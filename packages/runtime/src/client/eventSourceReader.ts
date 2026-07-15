import type { EventSource } from 'eventsource';

export interface EventSourceReaderOptions {
  maxQueuedEvents?: number;
  maxEvents?: number;
}

export async function* createEventSourceReader<T>(
  source: EventSource,
  eventName: string,
  options: EventSourceReaderOptions = {},
): AsyncGenerator<T> {
  const maxQueuedEvents = options.maxQueuedEvents ?? 1_000;
  const maxEvents = options.maxEvents ?? 10_000;
  const queue: T[] = [];
  let resolveNext: (() => void) | undefined;
  let closed = false;
  let eventCount = 0;
  let failure: Error | undefined;

  const fail = (error: Error): void => {
    failure = error;
    closed = true;
    source.close();
    resolveNext?.();
  };

  source.addEventListener(eventName, (event) => {
    try {
      eventCount += 1;
      if (eventCount > maxEvents) {
        fail(new Error(`EventSource event count exceeds limit ${maxEvents}`));
        return;
      }
      if (queue.length >= maxQueuedEvents) {
        fail(new Error(`EventSource queue exceeds limit ${maxQueuedEvents}`));
        return;
      }
      const data = 'data' in event ? JSON.parse(String((event as MessageEvent).data)) : null;
      queue.push(data);
      resolveNext?.();
    } catch (error: unknown) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  source.onerror = () => {
    closed = true;
    source.close();
    resolveNext?.();
  };

  try {
    while (!closed || queue.length > 0) {
      if (failure) throw failure;
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        resolveNext = undefined;
      }
      if (failure) throw failure;
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
      }
    }
  } finally {
    source.close();
  }
}
