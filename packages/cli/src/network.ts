import type { Command } from 'commander';
import {
  A2AClient,
  AgentRegistryClient,
  createDefaultClientOutboundPolicy,
  createOutboundPolicyFetch,
  redactHeaders,
  type A2AClientOptions,
} from '@a2amesh/runtime';

export interface NetworkCommandOptions {
  header?: string | string[];
  bearerToken?: string;
  apiKey?: string | string[];
  timeoutMs?: string;
  retries?: string;
  requestId?: string;
  origin?: string;
  allowPrivateNetwork?: boolean;
}

export interface ParsedNetworkOptions {
  headers: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  allowPrivateNetworks: boolean;
}

function collectOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function addNetworkOptions<TCommand extends Command>(command: TCommand): TCommand {
  command
    .option('--header <key:value...>', 'HTTP header to send; accepts one or more key:value entries')
    .option('--bearer-token <token>', 'Bearer token sent as Authorization: Bearer <token>')
    .option(
      '--api-key <name:value>',
      'API key header as name:value; repeat for multiple keys',
      collectOption,
    )
    .option('--timeout-ms <ms>', 'Per-request timeout in milliseconds')
    .option('--retries <count>', 'Retry count for transient network failures')
    .option('--request-id <id>', 'Request id sent as x-request-id')
    .option('--origin <url>', 'Origin header to send')
    .option('--allow-private-network', 'Allow explicitly requested private-network destinations');

  return command;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseHeaderEntry(entry: string, optionName: '--header' | '--api-key'): [string, string] {
  const separatorIndex = entry.indexOf(':');
  const key = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : '';
  const value = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : '';

  if (!key || !value) {
    throw new Error(`Invalid ${optionName} syntax. Expected <key:value>.`);
  }

  return [key, value];
}

function parseNonNegativeInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${optionName} value. Expected a non-negative integer.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${optionName} value. Expected a positive integer.`);
  }
  return parsed;
}

export function parseNetworkOptions(options: NetworkCommandOptions = {}): ParsedNetworkOptions {
  const headers: Record<string, string> = {};

  for (const entry of toArray(options.header)) {
    const [key, value] = parseHeaderEntry(entry, '--header');
    headers[key] = value;
  }

  if (options.bearerToken) {
    headers['Authorization'] = `Bearer ${options.bearerToken}`;
  }

  for (const entry of toArray(options.apiKey)) {
    const [key, value] = parseHeaderEntry(entry, '--api-key');
    headers[key] = value;
  }

  if (options.requestId) {
    headers['x-request-id'] = options.requestId;
  }

  if (options.origin) {
    headers['Origin'] = options.origin;
  }

  const parsed: ParsedNetworkOptions = {
    headers,
    allowPrivateNetworks: options.allowPrivateNetwork ?? false,
  };
  if (options.timeoutMs !== undefined) {
    parsed.timeoutMs = parsePositiveInteger(options.timeoutMs, '--timeout-ms');
  }
  if (options.retries !== undefined) {
    parsed.retries = parseNonNegativeInteger(options.retries, '--retries');
  }
  return parsed;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return { ...headers };
}

function createPolicyFetch(options: ParsedNetworkOptions): typeof fetch {
  return (async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : input;
    const policyFetch = createOutboundPolicyFetch({
      ...createDefaultClientOutboundPolicy(requestUrl),
      allowPrivateNetworks: options.allowPrivateNetworks,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.retries !== undefined ? { retries: options.retries } : {}),
    });
    const mergedHeaders = {
      ...headersToRecord(input instanceof Request ? input.headers : undefined),
      ...headersToRecord(init?.headers),
      ...options.headers,
    };
    return policyFetch(input, { ...init, headers: mergedHeaders });
  }) as typeof fetch;
}

export function createA2AClient(url: string, options: NetworkCommandOptions = {}): A2AClient {
  const networkOptions = parseNetworkOptions(options);
  const fetchImplementation = createPolicyFetch(networkOptions);
  const clientOptions: A2AClientOptions = {
    ...(Object.keys(networkOptions.headers).length > 0 ? { headers: networkOptions.headers } : {}),
    fetchImplementation,
    retry: { maxAttempts: 1, backoffMs: 0, retryOn: [] },
  };

  return new A2AClient(url, clientOptions);
}

export function createRegistryClient(
  url: string,
  options: NetworkCommandOptions = {},
): AgentRegistryClient {
  const networkOptions = parseNetworkOptions(options);
  const fetchImplementation = createPolicyFetch(networkOptions);
  return new AgentRegistryClient(url, fetchImplementation);
}

export function redactNetworkHeaders(headers: Record<string, string>): Record<string, string> {
  return redactHeaders(headers);
}
