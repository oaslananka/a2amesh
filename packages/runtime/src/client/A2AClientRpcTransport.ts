import { context, propagation } from '@opentelemetry/api';
import type {
  JsonRpcFailureResponse,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from '../types/jsonrpc.js';
import type { AfterArgs, CallInterceptor, ClientCallOptions } from './interceptors.js';
import {
  normalizeOfficialRpcResult,
  toOfficialV1RpcRequest,
  type A2AJsonRpcDialect,
} from '../utils/officialWire.js';

export interface A2AClientRpcTransportOptions {
  baseUrl: string;
  rpcPath: string;
  protocolVersion: string;
  jsonRpcDialect: A2AJsonRpcDialect;
  interceptors: CallInterceptor[];
  headers: Record<string, string>;
  fetchWithRetry: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>;
}

export interface A2AClientRpcTransport {
  rpc<T, TParams extends object>(method: string, params: TParams): Promise<T>;
  streamRpc<T, TParams extends object>(method: string, params: TParams): AsyncGenerator<T>;
}

export function createA2AClientRpcTransport(
  options: A2AClientRpcTransportOptions,
): A2AClientRpcTransport {
  async function executeRpcRequest<TParams extends object>(
    method: string,
    params: TParams,
    streamMode: boolean,
  ): Promise<Response> {
    const callOptions: ClientCallOptions = { headers: { ...options.headers } };
    const wireRequest =
      options.jsonRpcDialect === 'official-v1'
        ? toOfficialV1RpcRequest(method, params)
        : { method, params };
    const payload = {
      jsonrpc: '2.0' as const,
      id: globalThis.crypto.randomUUID(),
      method: wireRequest.method,
      params: wireRequest.params,
    };

    for (const interceptor of options.interceptors) {
      await interceptor.before({ method, body: payload, options: callOptions });
    }

    const headers = injectTraceHeaders({
      ...(streamMode ? { Accept: 'text/event-stream' } : {}),
      'Content-Type': 'application/json',
      ...callOptions.headers,
      ...callOptions.serviceParameters,
      'A2A-Version': options.protocolVersion,
    });

    return options.fetchWithRetry(new URL(options.rpcPath, options.baseUrl), {
      method: 'POST',
      headers,
      ...(callOptions.signal ? { signal: callOptions.signal } : {}),
      body: JSON.stringify(payload),
    });
  }

  async function handleRpcResponse<T>(json: JsonRpcResponse<T>, method: string): Promise<T> {
    if ('error' in json) {
      const failure = json as JsonRpcFailureResponse;
      throw new Error(`${failure.error.message} (${failure.error.code})`);
    }

    const success = json as JsonRpcSuccessResponse<T>;
    const normalizedResult = normalizeOfficialRpcResult(method, success.result) as T;
    for (const interceptor of options.interceptors) {
      await interceptor.after?.({ method, response: normalizedResult } satisfies AfterArgs<T>);
    }
    return normalizedResult;
  }

  async function rpc<T, TParams extends object>(method: string, params: TParams): Promise<T> {
    const response = await executeRpcRequest(method, params, false);

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`RPC request failed with status ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    return handleRpcResponse(json, method);
  }

  async function* streamRpc<T, TParams extends object>(
    method: string,
    params: TParams,
  ): AsyncGenerator<T> {
    const response = await executeRpcRequest(method, params, true);

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`RPC stream failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('RPC stream response did not include a readable body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replaceAll('\r\n', '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const result = await parseJsonRpcSseEvent<T>(rawEvent, method);
          if (result !== undefined) {
            yield result;
          }
          boundary = buffer.indexOf('\n\n');
        }

        if (done) {
          const result = await parseJsonRpcSseEvent<T>(buffer, method);
          if (result !== undefined) {
            yield result;
          }
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function parseJsonRpcSseEvent<T>(rawEvent: string, method: string): Promise<T | undefined> {
    const data = parseSseData(rawEvent);
    if (!data) {
      return undefined;
    }

    let json: JsonRpcResponse<T>;
    try {
      json = JSON.parse(data) as JsonRpcResponse<T>;
    } catch (error) {
      throw new Error(`RPC stream returned malformed JSON: ${String(error)}`, {
        cause: error,
      });
    }

    return handleRpcResponse(json, method);
  }

  return { rpc, streamRpc };
}

function parseSseData(rawEvent: string): string {
  return rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
}

function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  propagation.inject(context.active(), headers, {
    set(carrier, key, value) {
      (carrier as Record<string, string>)[key] = value;
    },
  });
  return headers;
}
