import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicAgent, researcherAgent, writerAgent } from '../test/fixtures';
import {
  installEventSourceMock,
  installFetchMock,
  MockRegistryEventSource,
} from '../test/test-utils';
import { useAgents } from './useAgents';

describe('useAgents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockRegistryEventSource.reset();
  });

  it('falls back to readonly public agents when authenticated listing is denied', async () => {
    const { calls } = installFetchMock([
      { path: '/api/agents', status: 401, body: { error: 'unauthorized' } },
      { path: '/api/agents?public=true', body: [publicAgent] },
      {
        path: '/api/context?public=true',
        body: {
          accessMode: 'readonly-public',
          authMethod: 'anonymous',
          tenantId: null,
          visibilityScope: 'public-only',
          healthStaleAfterMs: 240_000,
        },
      },
    ]);

    const { result, unmount } = renderHook(() => useAgents(60_000));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.accessMode).toBe('readonly-public');
    expect(result.current.context).toMatchObject({
      authMethod: 'anonymous',
      visibilityScope: 'public-only',
    });
    expect(result.current.agents).toEqual([publicAgent]);
    expect(calls).toEqual(['/api/agents', '/api/agents?public=true', '/api/context?public=true']);
    expect(MockRegistryEventSource.instances).toHaveLength(0);

    unmount();
  });

  it('subscribes to authenticated agent updates and applies live upserts and deletes', async () => {
    installEventSourceMock();
    installFetchMock([
      { path: '/api/agents', body: [researcherAgent] },
      {
        path: '/api/context',
        body: {
          accessMode: 'authenticated',
          authMethod: 'oidc',
          tenantId: 'tenant-a',
          visibilityScope: 'tenant-and-public',
          healthStaleAfterMs: 240_000,
        },
      },
    ]);

    const { result, unmount } = renderHook(() => useAgents(60_000));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(MockRegistryEventSource.instances).toHaveLength(1));

    const source = MockRegistryEventSource.instances[0];
    expect(source?.url).toBe('/api/agents/stream');
    expect(result.current.accessMode).toBe('authenticated');
    expect(result.current.context).toMatchObject({ authMethod: 'oidc', tenantId: 'tenant-a' });

    act(() => {
      source?.emitJson(writerAgent);
    });

    await waitFor(() =>
      expect(result.current.agents.map((agent) => agent.id)).toEqual([
        writerAgent.id,
        researcherAgent.id,
      ]),
    );

    act(() => {
      source?.emitJson({ id: researcherAgent.id, deleted: true });
    });

    await waitFor(() =>
      expect(result.current.agents.map((agent) => agent.id)).toEqual([writerAgent.id]),
    );

    act(() => {
      source?.emitMalformed();
      source?.fail();
    });

    await waitFor(() => expect(result.current.error).toBe('Live registry updates disconnected'));

    unmount();
    expect(source?.closed).toBe(true);
  });

  it('clears agent data and privileged mode when context loading fails closed', async () => {
    installFetchMock([
      { path: '/api/agents', body: [researcherAgent] },
      { path: '/api/context', status: 500, body: { detail: 'Context unavailable' } },
    ]);

    const { result } = renderHook(() => useAgents(60_000));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.agents).toEqual([]);
    expect(result.current.accessMode).toBe('readonly-public');
    expect(result.current.context.visibilityScope).toBe('public-only');
    expect(result.current.error).toBe('Registry context error: 500');
  });

  it('surfaces registry API errors from the private and public listing attempts', async () => {
    installFetchMock([
      { path: '/api/agents', status: 500, body: { error: 'broken' } },
      { path: '/api/agents?public=true', body: [publicAgent] },
    ]);

    const { result } = renderHook(() => useAgents(60_000));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBe('Registry error: 500');
  });
});
