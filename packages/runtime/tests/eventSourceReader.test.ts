import { describe, expect, it, vi } from 'vitest';
import type { EventSource } from 'eventsource';
import { createEventSourceReader } from '../src/client/eventSourceReader.js';

type Listener = (event: MessageEvent<string>) => void;

class ReaderEventSource {
  private readonly listeners = new Map<string, Listener[]>();
  readonly close = vi.fn();
  onerror: (() => void) | null = null;

  addEventListener(name: string, listener: Listener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name: string, value: unknown): void {
    this.emitRaw(name, JSON.stringify(value));
  }

  emitRaw(name: string, data: string): void {
    const event = { data } as MessageEvent<string>;
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function asEventSource(source: ReaderEventSource): EventSource {
  return source as unknown as EventSource;
}

describe('createEventSourceReader', () => {
  it('fails closed when producers outrun the bounded event queue', async () => {
    const source = new ReaderEventSource();
    const reader = createEventSourceReader<{ sequence: number }>(asEventSource(source), 'update', {
      maxQueuedEvents: 1,
    });
    const next = reader.next();

    source.emit('update', { sequence: 1 });
    source.emit('update', { sequence: 2 });

    await expect(next).rejects.toThrow('EventSource queue exceeds limit 1');
    expect(source.close).toHaveBeenCalled();
  });

  it('enforces an aggregate event-count limit', async () => {
    const source = new ReaderEventSource();
    const reader = createEventSourceReader<{ sequence: number }>(asEventSource(source), 'update', {
      maxEvents: 1,
      maxQueuedEvents: 10,
    });
    const next = reader.next();

    source.emit('update', { sequence: 1 });
    source.emit('update', { sequence: 2 });

    await expect(next).rejects.toThrow('EventSource event count exceeds limit 1');
    expect(source.close).toHaveBeenCalled();
  });

  it('closes and rejects malformed JSON events', async () => {
    const source = new ReaderEventSource();
    const reader = createEventSourceReader<unknown>(asEventSource(source), 'update');
    const next = reader.next();
    source.emitRaw('update', '{not-json');

    await expect(next).rejects.toThrow();
    expect(source.close).toHaveBeenCalled();
  });
});
