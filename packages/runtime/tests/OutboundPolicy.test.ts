import { promises as dns } from 'node:dns';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOutboundPolicyDnsCache,
  createOutboundPolicyFetch,
  createPinnedLookup,
  validateAndFetch,
  validateUrl,
} from '../src/net/OutboundPolicy.js';
import { FetchTimeoutError } from '../src/net/fetchWithPolicy.js';

afterEach(() => {
  clearOutboundPolicyDnsCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('OutboundPolicy validation', () => {
  it('blocks private IPs by default and allows loopback only when explicit', async () => {
    await expect(validateUrl('http://127.0.0.1:3000/webhook')).rejects.toThrow(
      'SSRF Prevention: Private IP addresses are not allowed',
    );

    const url = await validateUrl('http://127.0.0.1:3000/webhook', { allowLocalhost: true });

    expect(url.toString()).toBe('http://127.0.0.1:3000/webhook');
  });

  it('enforces configured HTTP schemes before DNS resolution', async () => {
    const resolveSpy = vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);

    await expect(validateUrl('http://example.com', { allowedSchemes: ['https'] })).rejects.toThrow(
      'Unsupported URL protocol',
    );

    const url = await validateUrl('https://example.com', { allowedSchemes: ['https'] });

    expect(url.hostname).toBe('example.com');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('caches successful DNS resolution within the configured TTL', async () => {
    const resolveSpy = vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);

    await validateUrl('https://cached.example/a', { dnsCacheTtlMs: 60_000 });
    await validateUrl('https://cached.example/b', { dnsCacheTtlMs: 60_000 });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('OutboundPolicy redirect enforcement', () => {
  it('rejects a redirect from a public host to loopback before the second request', async () => {
    const resolveSpy = vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/private' },
      }),
    );

    await expect(validateAndFetch('https://example.com/start')).rejects.toThrow(
      /private|not allowed/i,
    );

    expect(resolveSpy).toHaveBeenCalledWith('example.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('revalidates public redirects and strips credentials across origins', async () => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://redirected.example/final' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok'));

    const response = await validateAndFetch('https://example.com/start', {
      headers: {
        Authorization: 'Bearer secret',
        'x-request-id': 'request-1',
      },
    });

    await expect(response.text()).resolves.toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchSpy.mock.calls[0] ?? [];
    const [secondUrl, secondInit] = fetchSpy.mock.calls[1] ?? [];
    expect(firstInit?.redirect).toBe('manual');
    expect(secondUrl?.toString()).toBe('https://redirected.example/final');
    const secondHeaders = new Headers(secondInit?.headers);
    expect(secondHeaders.has('authorization')).toBe(false);
    expect(secondHeaders.get('x-request-id')).toBe('request-1');
  });

  it('rejects HTTPS-to-HTTP redirects unless explicitly permitted', async () => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
    const cancel = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel,
        }),
        {
          status: 307,
          headers: { Location: 'http://redirected.example/final' },
        },
      ),
    );

    await expect(validateAndFetch('https://example.com/start')).rejects.toThrow(
      'HTTPS-to-HTTP redirects are not allowed',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('enforces the configured redirect hop limit', async () => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: '/next' } }),
    );

    await expect(
      validateAndFetch('https://example.com/start', undefined, { maxRedirects: 1 }),
    ).rejects.toThrow('Redirect limit 1 exceeded');
  });
});

describe('OutboundPolicy DNS binding', () => {
  it('returns only the prevalidated address from the connection lookup', async () => {
    const lookup = createPinnedLookup(['93.184.216.34']);

    const result = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
      lookup('rebound.example', { family: 0, all: false }, (error, address, family) => {
        if (error) reject(error);
        else {
          const result = { address: String(address), ...(family !== undefined ? { family } : {}) };
          resolve(result);
        }
      });
    });

    expect(result).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('filters pinned addresses by requested family and rejects an unavailable family', async () => {
    const dualStackLookup = createPinnedLookup(['93.184.216.34', '2001:db8::1']);
    const ipv6 = await new Promise<unknown>((resolve, reject) => {
      dualStackLookup('dual.example', { family: 6, all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(ipv6).toEqual([{ address: '2001:db8::1', family: 6 }]);

    const ipv4OnlyLookup = createPinnedLookup(['93.184.216.34']);
    await expect(
      new Promise((resolve, reject) => {
        ipv4OnlyLookup('ipv4.example', { family: 6, all: false }, (error, address) => {
          if (error) reject(error);
          else resolve(address);
        });
      }),
    ).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });

  it('merges Request metadata and explicit init overrides before policy fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const policyFetch = createOutboundPolicyFetch({
      resolveHostname: async () => ['93.184.216.34'],
    });
    const request = new Request('https://example.com/request', {
      method: 'POST',
      headers: { 'x-request-header': 'request' },
      body: 'request-body',
    });

    const response = await policyFetch(request, {
      headers: { 'x-init-header': 'init' },
      body: 'override-body',
    });
    await response.text();

    const [input, init] = fetchSpy.mock.calls[0] ?? [];
    expect(input?.toString()).toBe('https://example.com/request');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('override-body');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-request-header')).toBe('request');
    expect(headers.get('x-init-header')).toBe('init');
  });

  it('connects through the validated custom DNS result instead of system DNS', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('bound');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const resolver = vi.fn().mockResolvedValue(['127.0.0.1']);

    try {
      const response = await validateAndFetch(`http://bound.invalid:${port}/health`, undefined, {
        allowLocalhost: true,
        resolveHostname: resolver,
      });

      await expect(response.text()).resolves.toBe('bound');
      expect(resolver).toHaveBeenCalledWith('bound.invalid');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not retry a deterministic target-policy violation', async () => {
    const resolver = vi.fn().mockResolvedValue(['10.0.0.1']);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      validateAndFetch('https://private.example/resource', undefined, {
        retries: 3,
        backoffBaseMs: 0,
        resolveHostname: resolver,
      }),
    ).rejects.toThrow(/private/i);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the same loopback DNS result when localhost access is not explicit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      validateAndFetch('http://rebind.invalid/resource', undefined, {
        resolveHostname: async () => ['127.0.0.1'],
      }),
    ).rejects.toThrow(/private/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('OutboundPolicy total deadline', () => {
  it('covers DNS resolution before connection establishment', async () => {
    const neverResolves = new Promise<string[]>(() => undefined);

    await expect(
      validateAndFetch('https://slow-dns.example/resource', undefined, {
        timeoutMs: 20,
        resolveHostname: () => neverResolves,
      }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('keeps the deadline active after real response headers arrive', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('partial');
      // Deliberately keep the body open until the policy aborts the connection.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await validateAndFetch(
        `http://slow-body.invalid:${port}/resource`,
        undefined,
        {
          allowLocalhost: true,
          resolveHostname: async () => ['127.0.0.1'],
          timeoutMs: 40,
        },
      );

      await expect(response.text()).rejects.toBeInstanceOf(FetchTimeoutError);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('validates and fetches through the shared bounded response policy', async () => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await validateAndFetch(
      'https://example.com/data?token=secret',
      {
        headers: { Authorization: 'Bearer secret' },
      },
      {
        timeoutMs: 250,
        maxResponseBytes: 1_024,
        telemetryLabels: { 'a2a.operation': 'test' },
      },
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0] ?? [];
    expect(input?.toString()).toBe('https://example.com/data?token=secret');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('manual');
    expect((init as RequestInit & { dispatcher?: unknown })?.dispatcher).toBeDefined();
  });
});
