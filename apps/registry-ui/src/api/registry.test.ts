import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../test/test-utils';
import { deleteAgent, registerAgent, RegistryApiError } from './registry';

describe('registerAgent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the registration payload and returns the registered agent', async () => {
    const registered = {
      id: 'agent-new',
      url: 'http://localhost:4001',
      status: 'unknown',
      card: { name: 'New Agent', description: 'A new agent.', version: '1.0.0' },
    };
    const { fetchMock } = installFetchMock([
      { path: '/api/agents/register', status: 201, body: registered },
    ]);

    const result = await registerAgent({
      agentUrl: 'http://localhost:4001',
      agentCard: {
        protocolVersion: '1.0',
        name: 'New Agent',
        description: 'A new agent.',
        url: 'http://localhost:4001',
        version: '1.0.0',
      },
      isPublic: true,
    });

    expect(result).toEqual(registered);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toMatchObject({
      agentUrl: 'http://localhost:4001',
      isPublic: true,
    });
  });

  it('throws a RegistryApiError with the problem detail on failure', async () => {
    installFetchMock([
      {
        path: '/api/agents/register',
        status: 400,
        body: { detail: 'Missing agentUrl or agentCard' },
      },
    ]);

    await expect(
      registerAgent({
        agentUrl: '',
        agentCard: {
          protocolVersion: '1.0',
          name: '',
          description: '',
          url: '',
          version: '',
        },
      }),
    ).rejects.toMatchObject({
      message: 'Missing agentUrl or agentCard',
      status: 400,
    });
  });

  it('falls back to a generic message when the error body is not JSON problem detail', async () => {
    installFetchMock([{ path: '/api/agents/register', status: 500, body: undefined }]);

    await expect(
      registerAgent({
        agentUrl: 'http://localhost:4001',
        agentCard: {
          protocolVersion: '1.0',
          name: 'Agent',
          description: 'Agent',
          url: 'http://localhost:4001',
          version: '1.0.0',
        },
      }),
    ).rejects.toMatchObject({
      message: 'Registry error: 500',
      status: 500,
    });
  });
});

describe('deleteAgent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a DELETE request for the agent id', async () => {
    const { fetchMock } = installFetchMock([{ path: '/api/agents/agent-writer', status: 204 }]);

    await deleteAgent('agent-writer');

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/agents/agent-writer');
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
  });

  it('throws a RegistryApiError with the problem detail on failure', async () => {
    installFetchMock([
      { path: '/api/agents/missing', status: 404, body: { detail: 'Agent not found' } },
    ]);

    await expect(deleteAgent('missing')).rejects.toBeInstanceOf(RegistryApiError);
    await expect(deleteAgent('missing')).rejects.toMatchObject({
      message: 'Agent not found',
      status: 404,
    });
  });
});
