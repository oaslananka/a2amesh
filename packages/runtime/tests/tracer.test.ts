import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baggage, BaggageEntry, Context } from '@opentelemetry/api';

interface MockBaggage extends Baggage {
  entries: Record<string, BaggageEntry>;
  setEntry: (key: string, value: BaggageEntry) => MockBaggage;
  getEntry: (key: string) => BaggageEntry | undefined;
  getAllEntries: () => Array<[string, BaggageEntry]>;
  removeEntry: (key: string) => MockBaggage;
  removeEntries: (...keys: string[]) => MockBaggage;
  clear: () => MockBaggage;
}

function createMockBaggage(entries: Record<string, BaggageEntry> = {}): MockBaggage {
  return {
    entries,
    setEntry(key: string, value: BaggageEntry) {
      return createMockBaggage({
        ...entries,
        [key]: value,
      });
    },
    getEntry(key: string) {
      return entries[key];
    },
    getAllEntries() {
      return Object.entries(entries);
    },
    removeEntry(key: string) {
      const nextEntries = { ...entries };
      delete nextEntries[key];
      return createMockBaggage(nextEntries);
    },
    removeEntries(...keys: string[]) {
      const nextEntries = { ...entries };
      for (const key of keys) {
        delete nextEntries[key];
      }
      return createMockBaggage(nextEntries);
    },
    clear() {
      return createMockBaggage();
    },
  };
}

vi.mock('@opentelemetry/api', () => {
  const getBaggage = vi.fn();
  const createBaggage = vi.fn(() => createMockBaggage());
  const setBaggage = vi.fn((activeContext: unknown, baggage: unknown) => ({
    activeContext,
    baggage,
  }));
  const active = vi.fn(() => 'active-context');
  const withContext = vi.fn((nextContext: unknown, callback: () => void) => {
    callback();
    return nextContext;
  });
  const getTracer = vi.fn((name: string, version: string) => ({
    name,
    version,
    startSpan: vi.fn(() => 'span'),
  }));

  return {
    SpanStatusCode: {
      OK: 'OK',
      ERROR: 'ERROR',
    },
    baggageEntryMetadataFromString: vi.fn((value: string) => ({ value })),
    context: {
      active,
      with: withContext,
    },
    propagation: {
      getBaggage,
      createBaggage,
      setBaggage,
      extract: vi.fn(),
    },
    trace: {
      getTracer,
    },
  };
});

import { baggageEntryMetadataFromString, propagation, trace } from '@opentelemetry/api';
import {
  SpanStatusCode,
  a2aMeshTracer,
  extractA2AContext,
  withA2ABaggage,
} from '../src/telemetry/tracer.js';

describe('tracer helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates baggage entries for task and context ids', () => {
    vi.mocked(propagation.getBaggage).mockReturnValue(undefined);

    const result = withA2ABaggage('task-1', 'ctx-1');

    expect(propagation.createBaggage).toHaveBeenCalledWith({});
    expect(baggageEntryMetadataFromString).toHaveBeenCalledWith('a2a');
    expect(propagation.setBaggage).toHaveBeenCalledWith(
      'active-context',
      expect.objectContaining({
        entries: expect.objectContaining({
          'a2a.task_id': expect.objectContaining({ value: 'task-1' }),
          'a2a.context_id': expect.objectContaining({ value: 'ctx-1' }),
        }),
      }),
    );
    expect(result).toEqual({
      activeContext: 'active-context',
      baggage: expect.anything(),
    });
  });

  it('reuses existing baggage when no ids are provided', () => {
    const existingBaggage = createMockBaggage({
      persisted: { value: 'yes' },
    });
    vi.mocked(propagation.getBaggage).mockReturnValue(existingBaggage);

    const result = withA2ABaggage();

    expect(propagation.createBaggage).not.toHaveBeenCalled();
    expect(propagation.setBaggage).toHaveBeenCalledWith('active-context', existingBaggage);
    expect(result).toEqual({
      activeContext: 'active-context',
      baggage: existingBaggage,
    });
  });

  it('exports the tracer instance and span status codes', () => {
    expect(typeof trace.getTracer).toBe('function');
    expect(a2aMeshTracer.startSpan('test-span')).toBe('span');
    expect(trace.getTracer).toHaveBeenCalledWith('@a2amesh/runtime', '1.0.0');
    expect(SpanStatusCode.OK).toBe('OK');
    expect(SpanStatusCode.ERROR).toBe('ERROR');
  });

  it('extracts A2A context from single and repeated carrier headers', () => {
    vi.mocked(propagation.extract).mockImplementation((_activeContext, carrier, getter) => {
      expect(getter).toBeDefined();
      const textMapGetter = getter ?? {
        get: () => undefined,
        keys: () => [],
      };
      return {
        traceparent: textMapGetter.get(carrier, 'traceparent'),
        keys: textMapGetter.keys(carrier),
      } as unknown as Context;
    });

    const result = extractA2AContext({
      traceparent: ['first', 'second'],
      baggage: 'a2a.task_id=task-1',
    }) as unknown as { traceparent: string; keys: string[] };

    expect(result.traceparent).toBe('first');
    expect(result.keys).toEqual(['traceparent', 'baggage']);
  });
});
