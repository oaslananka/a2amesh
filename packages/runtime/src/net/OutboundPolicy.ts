import { promises as dns, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import {
  executeFetchWithPolicy,
  FetchTargetPolicyError,
  type FetchPolicyOptions,
  type PreparedFetchTarget,
} from './fetchWithPolicy.js';
import { validateSafeUrl, type SafeUrlOptions } from '../security/url.js';

export interface OutboundPolicyOptions extends SafeUrlOptions, FetchPolicyOptions {
  /** Allowed outbound HTTP schemes. Defaults to http and https. */
  allowedSchemes?: readonly string[];
  /** Cache validated DNS results for this many milliseconds. Disabled by default. */
  dnsCacheTtlMs?: number;
  /** Custom fetch implementation for tests or controlled integrations. It must honor AbortSignal and dispatcher. */
  fetchImplementation?: typeof fetch;
}

type DnsCacheEntry = {
  addresses: string[];
  expiresAt: number;
};

const dnsCache = new Map<string, DnsCacheEntry>();

export async function validateUrl(
  url: string | URL,
  policy: OutboundPolicyOptions = {},
): Promise<URL> {
  const parsed = parseAndValidateScheme(url, policy);
  return validateSafeUrl(parsed.toString(), createSafeUrlOptions(policy));
}

export async function validateAndFetch(
  url: string | URL,
  init?: RequestInit,
  policy: OutboundPolicyOptions = {},
): Promise<Response> {
  return executeFetchWithPolicy(url, init, policy, {
    resolveTarget: (target, signal) => prepareValidatedTarget(target, policy, signal),
    ...(policy.fetchImplementation ? { fetchImplementation: policy.fetchImplementation } : {}),
  });
}

export function createOutboundPolicyFetch(policy: OutboundPolicyOptions = {}): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = input instanceof Request ? input.url : input;
    const requestInit = input instanceof Request ? mergeRequestInit(input, init) : init;
    return validateAndFetch(requestUrl, requestInit, policy);
  }) as typeof fetch;
}

export function clearOutboundPolicyDnsCache(): void {
  dnsCache.clear();
}

/**
 * Creates a DNS lookup function that can return only the addresses validated for this request.
 * The host operating system resolver is never called by the connection after validation.
 */
export function createPinnedLookup(addresses: readonly string[]): LookupFunction {
  const records = addresses.map(toLookupAddress);
  if (records.length === 0) {
    throw new Error('Outbound connection requires at least one validated IP address');
  }
  let cursor = 0;

  return (_hostname, options, callback) => {
    const requestedFamily = options.family;
    const eligible =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((record) => record.family === requestedFamily)
        : records;

    if (eligible.length === 0) {
      const error = new Error(
        'No validated address matches the requested IP family',
      ) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      queueMicrotask(() => callback(error, ''));
      return;
    }

    if (options.all) {
      queueMicrotask(() => callback(null, eligible));
      return;
    }

    const record = eligible[cursor % eligible.length];
    cursor += 1;
    if (!record) {
      const error = new Error('Validated address selection failed') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      queueMicrotask(() => callback(error, ''));
      return;
    }
    queueMicrotask(() => callback(null, record.address, record.family));
  };
}

async function prepareValidatedTarget(
  input: URL,
  policy: OutboundPolicyOptions,
  signal: AbortSignal,
): Promise<PreparedFetchTarget> {
  let parsed: URL;
  try {
    parsed = parseAndValidateScheme(input, policy);
  } catch (error: unknown) {
    throw asTargetPolicyError(error);
  }

  const hostname = normalizeHostname(parsed.hostname);
  const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname, policy, signal);

  if (addresses.length === 0) {
    throw new FetchTargetPolicyError(
      'SSRF Prevention: Hostname resolved without usable IP addresses',
    );
  }

  let validated: URL;
  try {
    validated = await validateSafeUrl(parsed.toString(), {
      ...createSafeUrlOptions(policy),
      resolveHostname: async () => addresses,
      allowUnresolvedHostnames: false,
    });
  } catch (error: unknown) {
    throw asTargetPolicyError(error);
  }

  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(addresses),
      timeout: policy.timeoutMs ?? 30_000,
    },
    headersTimeout: policy.timeoutMs ?? 30_000,
    bodyTimeout: 0,
    ...(policy.maxResponseBytes !== undefined ? { maxResponseSize: policy.maxResponseBytes } : {}),
  });

  return {
    url: validated,
    dispatcher,
    async release() {
      await dispatcher.close();
    },
  };
}

function parseAndValidateScheme(url: string | URL, policy: OutboundPolicyOptions): URL {
  const parsed = parseUrl(url.toString());
  const allowedSchemes = new Set((policy.allowedSchemes ?? ['http', 'https']).map(normalizeScheme));
  if (!allowedSchemes.has(parsed.protocol)) {
    throw new Error(
      `Unsupported URL protocol. Allowed protocols: ${Array.from(allowedSchemes).join(', ')}`,
    );
  }
  return parsed;
}

function parseUrl(urlString: string): URL {
  try {
    return new URL(urlString);
  } catch (error: unknown) {
    throw new Error('Invalid URL format', { cause: error });
  }
}

function normalizeScheme(scheme: string): string {
  const normalized = scheme.toLowerCase();
  return normalized.endsWith(':') ? normalized : `${normalized}:`;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function createSafeUrlOptions(policy: OutboundPolicyOptions): SafeUrlOptions {
  const safeOptions: SafeUrlOptions = {
    ...(policy.allowLocalhost !== undefined ? { allowLocalhost: policy.allowLocalhost } : {}),
    ...(policy.allowPrivateNetworks !== undefined
      ? { allowPrivateNetworks: policy.allowPrivateNetworks }
      : {}),
    ...(policy.allowUnresolvedHostnames !== undefined
      ? { allowUnresolvedHostnames: policy.allowUnresolvedHostnames }
      : {}),
    ...(policy.allowedHostnames !== undefined ? { allowedHostnames: policy.allowedHostnames } : {}),
  };

  const resolver = policy.resolveHostname ?? dns.resolve;
  const ttlMs = policy.dnsCacheTtlMs ?? 0;
  if (ttlMs > 0) {
    safeOptions.resolveHostname = (hostname) => resolveHostnameWithCache(hostname, ttlMs, resolver);
  } else if (policy.resolveHostname) {
    safeOptions.resolveHostname = policy.resolveHostname;
  }

  return safeOptions;
}

async function resolveAddresses(
  hostname: string,
  policy: OutboundPolicyOptions,
  signal: AbortSignal,
): Promise<string[]> {
  const resolver = policy.resolveHostname ?? dns.resolve;
  const ttlMs = policy.dnsCacheTtlMs ?? 0;
  let addresses: string[];
  try {
    addresses = await withAbort(
      ttlMs > 0 ? resolveHostnameWithCache(hostname, ttlMs, resolver) : resolver(hostname),
      signal,
    );
  } catch (error: unknown) {
    if (signal.aborted) throw abortReason(signal);
    if (policy.allowUnresolvedHostnames) {
      throw new FetchTargetPolicyError(
        'SSRF Prevention: Unresolved hostnames cannot be safely bound to an outbound connection',
        { cause: error },
      );
    }
    throw new Error('SSRF Prevention: Hostname could not be resolved', { cause: error });
  }

  const normalized = Array.from(new Set(addresses.map(normalizeHostname)));
  for (const address of normalized) {
    if (!isIP(address)) {
      throw new FetchTargetPolicyError('SSRF Prevention: DNS resolver returned a non-IP address');
    }
  }
  return normalized;
}

function asTargetPolicyError(error: unknown): FetchTargetPolicyError {
  if (error instanceof FetchTargetPolicyError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new FetchTargetPolicyError(message, {
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

async function resolveHostnameWithCache(
  hostname: string,
  ttlMs: number,
  resolver: (hostname: string) => Promise<string[]>,
): Promise<string[]> {
  const cacheKey = hostname.toLowerCase();
  const cached = dnsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return [...cached.addresses];
  }

  const addresses = await resolver(hostname);
  dnsCache.set(cacheKey, {
    addresses: [...addresses],
    expiresAt: now + ttlMs,
  });
  return [...addresses];
}

function toLookupAddress(address: string): LookupAddress {
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    throw new Error(`Invalid validated IP address: ${address}`);
  }
  return { address, family };
}

function mergeRequestInit(request: Request, init: RequestInit | undefined): RequestInit {
  const headers = new Headers(request.headers);
  if (init?.headers) {
    for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
  }
  const hasInitBody = init !== undefined && Object.prototype.hasOwnProperty.call(init, 'body');
  const body = hasInitBody ? init?.body : request.body;
  const merged = {
    cache: init?.cache ?? request.cache,
    credentials: init?.credentials ?? request.credentials,
    integrity: init?.integrity ?? request.integrity,
    keepalive: init?.keepalive ?? request.keepalive,
    method: init?.method ?? request.method,
    mode: init?.mode ?? request.mode,
    redirect: init?.redirect ?? request.redirect,
    referrer: init?.referrer ?? request.referrer,
    referrerPolicy: init?.referrerPolicy ?? request.referrerPolicy,
    ...init,
    headers,
    signal: init?.signal ?? request.signal,
    ...(body !== undefined && body !== null ? { body } : {}),
  } as RequestInit;

  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    (merged as RequestInit & { duplex: 'half' }).duplex = 'half';
  }
  return merged;
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Creates the default client policy. An explicitly configured loopback URL grants loopback access;
 * public hostnames and private-network addresses remain fail closed.
 */
export function createDefaultClientOutboundPolicy(url: string | URL): OutboundPolicyOptions {
  const hostname = normalizeHostname(parseUrl(url.toString()).hostname).toLowerCase();
  return { allowLocalhost: isExplicitLoopbackHostname(hostname) };
}

function isExplicitLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (isIP(hostname) === 4) return hostname.split('.')[0] === '127';
  if (isIP(hostname) === 6) {
    return hostname === '::1' || hostname === '0:0:0:0:0:0:0:1';
  }
  return false;
}
