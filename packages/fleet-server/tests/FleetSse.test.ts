import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createFleetSse } from '../src/server/sse.js';

interface FakeResponse {
  writes: string[];
  ended: boolean;
  close?: () => void;
}

function fakeResponse(): { response: Response; state: FakeResponse } {
  const state: FakeResponse = { writes: [], ended: false };
  const response = {
    writeHead: () => response,
    write: (value: string) => {
      state.writes.push(value);
      return true;
    },
    end: () => {
      state.ended = true;
      return response;
    },
    on: (event: string, listener: () => void) => {
      if (event === 'close') state.close = listener;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

describe('Fleet SSE tenant isolation', () => {
  it('broadcasts tenant events only to matching or administrator clients', () => {
    const sse = createFleetSse();
    const tenantA = fakeResponse();
    const tenantB = fakeResponse();
    const administrator = fakeResponse();

    sse.addClient(tenantA.response, { tenantId: 'tenant-a' });
    sse.addClient(tenantB.response, { tenantId: 'tenant-b' });
    sse.addClient(administrator.response, { allTenants: true });
    sse.broadcast('run-updated', { id: 'run-a' }, { tenantId: 'tenant-a' });

    expect(tenantA.state.writes.join('')).toContain('run-a');
    expect(tenantB.state.writes.join('')).not.toContain('run-a');
    expect(administrator.state.writes.join('')).toContain('run-a');
  });

  it('removes closed clients and closes remaining clients on shutdown', () => {
    const sse = createFleetSse();
    const closed = fakeResponse();
    const active = fakeResponse();
    sse.addClient(closed.response, { tenantId: 'tenant-a' });
    sse.addClient(active.response, { tenantId: 'tenant-a' });

    closed.state.close?.();
    sse.broadcast('run-updated', { id: 'run-a' }, { tenantId: 'tenant-a' });
    expect(closed.state.writes.join('')).not.toContain('run-a');
    expect(active.state.writes.join('')).toContain('run-a');

    sse.closeAllClients();
    expect(active.state.ended).toBe(true);
    expect(closed.state.ended).toBe(false);
  });
});
