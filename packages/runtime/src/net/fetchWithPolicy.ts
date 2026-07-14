import { logger } from '../utils/logger.js';
import {
  isSensitiveHeaderName,
  redactHeaders,
  redactRecord,
  redactSensitiveText,
  redactUrl,
} from '../utils/redaction.js';
export { redactHeaders } from '../utils/redaction.js';
import { a2aMeshTracer, SpanStatusCode } from '../telemetry/index.js';
import {
  FetchIdleTimeoutError,
  FetchResponseLimitError,
  FetchSseLimitError,
  wrapResponseWithLimits,
} from './responseLimits.js';

export {
  FetchIdleTimeoutError,
  FetchResponseLimitError,
  FetchSseLimitError,
  readSseData,
} from './responseLimits.js';

export type FetchTelemetryLabels = Record<string, string | number | boolean>;

export interface FetchPolicyOptions {
  /** Total deadline for DNS, connect, headers, redirects, retries, and body consumption. Default: 30000. */
  timeoutMs?: number;
  /** Number of retry attempts for transient failures. Default: 0. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 500. */
  backoffBaseMs?: number;
  /** Maximum delay in milliseconds for exponential backoff. Default: 10000. */
  backoffMaxMs?: number;
  /** Whether to add full jitter to retry delays. Default: true. */
  jitter?: boolean;
  /** AbortSignal that cancels DNS, retries, redirects, and body consumption. */
  signal?: AbortSignal;
  /** Additional outbound telemetry labels. Sensitive keys are redacted. */
  telemetryLabels?: FetchTelemetryLabels;
  /** Maximum redirect hops. Redirects require a validating target resolver. Default: 5. */
  maxRedirects?: number;
  /** Permit HTTPS-to-HTTP redirects. Default: false. */
  allowInsecureRedirects?: boolean;
  /** Maximum response body bytes across JSON, text, binary, or SSE. Default: 10 MiB. */
  maxResponseBytes?: number;
  /** Maximum SSE events in one response. Default: 10000. */
  maxSseEvents?: number;
  /** Maximum bytes in one SSE line. Default: 64 KiB. */
  maxSseLineBytes?: number;
  /** Maximum bytes buffered for one SSE event. Default: 1 MiB. */
  maxSseBufferBytes?: number;
  /** Maximum SSE idle interval. Set to 0 to disable. Default: 30000. */
  sseIdleTimeoutMs?: number;
  /** Permit retries for non-idempotent methods without an idempotency key. Default: false. */
  retryNonIdempotent?: boolean;
  /** Header used to authorize non-idempotent retries. Default: Idempotency-Key. */
  idempotencyKeyHeader?: string;
}

export interface PreparedFetchTarget {
  url: URL;
  dispatcher?: unknown;
  release?: () => void | Promise<void>;
}

export type FetchTargetResolver = (url: URL, signal: AbortSignal) => Promise<PreparedFetchTarget>;

interface FetchExecutionOptions {
  resolveTarget?: FetchTargetResolver;
  fetchImplementation?: typeof fetch;
}

interface AttemptResult {
  response: Response;
  release: () => Promise<void>;
  finalUrl: URL;
  redirects: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SSE_EVENTS = 10_000;
const DEFAULT_MAX_SSE_LINE_BYTES = 64 * 1024;
const DEFAULT_MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 30_000;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

export class FetchRedirectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FetchRedirectError';
  }
}

export class FetchTargetPolicyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FetchTargetPolicyError';
  }
}

/**
 * Applies total-deadline, bounded-response, method-aware retry, and telemetry policy.
 * Redirects are rejected unless an internal validating resolver is supplied by OutboundPolicy.
 */
export async function fetchWithPolicy(
  url: string | URL,
  init?: RequestInit,
  options: FetchPolicyOptions = {},
): Promise<Response> {
  return executeFetchWithPolicy(url, init, options);
}

/** @internal Used by OutboundPolicy to bind every redirect hop to a validated target. */
export async function executeFetchWithPolicy(
  url: string | URL,
  init: RequestInit | undefined,
  options: FetchPolicyOptions = {},
  execution: FetchExecutionOptions = {},
): Promise<Response> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const requestedRetries = nonNegativeInteger(options.retries, 0, 'retries');
  const backoffBaseMs = nonNegativeInteger(options.backoffBaseMs, 500, 'backoffBaseMs');
  const backoffMaxMs = nonNegativeInteger(options.backoffMaxMs, 10_000, 'backoffMaxMs');
  const maxRedirects = nonNegativeInteger(
    options.maxRedirects,
    DEFAULT_MAX_REDIRECTS,
    'maxRedirects',
  );
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  );
  const maxSseEvents = positiveInteger(
    options.maxSseEvents,
    DEFAULT_MAX_SSE_EVENTS,
    'maxSseEvents',
  );
  const maxSseLineBytes = positiveInteger(
    options.maxSseLineBytes,
    DEFAULT_MAX_SSE_LINE_BYTES,
    'maxSseLineBytes',
  );
  const maxSseBufferBytes = positiveInteger(
    options.maxSseBufferBytes,
    DEFAULT_MAX_SSE_BUFFER_BYTES,
    'maxSseBufferBytes',
  );
  const sseIdleTimeoutMs = nonNegativeInteger(
    options.sseIdleTimeoutMs,
    DEFAULT_SSE_IDLE_TIMEOUT_MS,
    'sseIdleTimeoutMs',
  );
  const method = normalizeMethod(init?.method);
  const allowInsecureRedirects = options.allowInsecureRedirects ?? false;
  const externalSignal = combineSignals(options.signal, init?.signal);
  const retryable = canRetryRequest(method, init, options);
  const maxRetries = retryable ? requestedRetries : 0;
  const operationController = new AbortController();
  let operationFinalized = false;
  const abortFromUser = (): void => {
    const reason =
      externalSignal?.reason instanceof Error
        ? externalSignal.reason
        : new DOMException('The operation was aborted', 'AbortError');
    operationController.abort(reason);
  };

  if (externalSignal?.aborted) abortFromUser();
  else externalSignal?.addEventListener('abort', abortFromUser, { once: true });

  const timeoutId = setTimeout(() => {
    operationController.abort(new FetchTimeoutError(`Fetch timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const finalizeOperation = (): void => {
    if (operationFinalized) return;
    operationFinalized = true;
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromUser);
  };

  if (!retryable && requestedRetries > 0) {
    logger.debug('Retries disabled for non-idempotent outbound request', {
      url: redactUrl(url),
      method,
      requestedRetries,
    });
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    if (operationController.signal.aborted) {
      finalizeOperation();
      throw abortReason(operationController.signal);
    }

    const safeUrl = redactUrl(url);
    const span = a2aMeshTracer.startSpan('http.request', {
      attributes: {
        ...redactRecord(options.telemetryLabels ?? {}),
        'http.method': method,
        'http.url': safeUrl,
        'http.attempt': attempt + 1,
        'http.max_retries': maxRetries,
      },
    });
    let spanEnded = false;
    let spanFailed = false;
    const endSpan = (): void => {
      if (spanEnded) return;
      spanEnded = true;
      span.end();
    };
    const recordSpanError = (error: Error): void => {
      spanFailed = true;
      if (spanEnded) return;
      const message = redactSensitiveText(error.message);
      span.recordException({ name: error.name, message });
      span.setStatus({ code: SpanStatusCode.ERROR, message });
    };

    try {
      logger.debug('Fetching URL', {
        url: safeUrl,
        method,
        headers: redactHeaders(init?.headers),
        attempt: attempt + 1,
      });

      const result = await performAttempt(
        parseFetchUrl(url),
        init,
        operationController.signal,
        maxRedirects,
        allowInsecureRedirects,
        execution.resolveTarget,
        execution.fetchImplementation ?? globalThis.fetch,
      );
      const { response } = result;
      span.setAttribute('http.status_code', response.status);
      span.setAttribute('http.redirect_count', result.redirects);
      span.setAttribute('http.final_url', redactUrl(result.finalUrl));

      if (attempt < maxRetries && isTransientStatus(response.status)) {
        logger.warn('Transient HTTP error, retrying', {
          url: redactUrl(result.finalUrl),
          status: response.status,
          attempt: attempt + 1,
          maxRetries,
        });
        await response.body?.cancel().catch(() => undefined);
        await result.release();
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Transient error ${response.status}`,
        });
        endSpan();
      } else {
        if (!response.ok) {
          spanFailed = true;
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
        }

        return await wrapResponseWithLimits(response, {
          maxResponseBytes,
          maxSseEvents,
          maxSseLineBytes,
          maxSseBufferBytes,
          sseIdleTimeoutMs,
          signal: operationController.signal,
          abort(reason) {
            if (!operationController.signal.aborted) operationController.abort(reason);
          },
          onError: recordSpanError,
          async finalize() {
            await result.release();
            if (!spanFailed) span.setStatus({ code: SpanStatusCode.OK });
            endSpan();
            finalizeOperation();
          },
        });
      }
    } catch (error: unknown) {
      const normalized = normalizeFetchError(error, operationController.signal);
      lastError = normalized;
      recordSpanError(normalized);
      endSpan();

      if (operationController.signal.aborted || isNonRetryablePolicyError(normalized)) {
        finalizeOperation();
        throw normalized;
      }

      if (attempt >= maxRetries) {
        logger.error('Fetch failed after max retries', {
          url: safeUrl,
          attempt: attempt + 1,
          error: redactSensitiveText(normalized.message),
        });
        finalizeOperation();
        throw normalized;
      }

      logger.warn('Fetch attempt failed, retrying', {
        url: safeUrl,
        attempt: attempt + 1,
        error: redactSensitiveText(normalized.message),
      });
    }

    const delayMs = calculateBackoff(attempt, backoffBaseMs, backoffMaxMs, options.jitter ?? true);
    try {
      await delayWithSignal(delayMs, operationController.signal);
    } catch (error: unknown) {
      finalizeOperation();
      throw normalizeFetchError(error, operationController.signal);
    }
    attempt += 1;
  }

  finalizeOperation();
  throw lastError instanceof Error ? lastError : new Error('Fetch failed with unknown error');
}

async function performAttempt(
  initialUrl: URL,
  initialInit: RequestInit | undefined,
  signal: AbortSignal,
  maxRedirects: number,
  allowInsecureRedirects: boolean,
  resolveTarget: FetchTargetResolver | undefined,
  fetchImplementation: typeof fetch,
): Promise<AttemptResult> {
  let currentUrl = initialUrl;
  let currentInit = { ...(initialInit ?? {}) };
  let redirects = 0;

  while (true) {
    if (signal.aborted) throw abortReason(signal);
    const target = resolveTarget
      ? await resolveTarget(currentUrl, signal)
      : ({ url: currentUrl } satisfies PreparedFetchTarget);
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      await target.release?.();
    };

    try {
      const networkInit = {
        ...currentInit,
        redirect: 'manual',
        signal,
        ...(target.dispatcher !== undefined ? { dispatcher: target.dispatcher } : {}),
      } as RequestInit;
      const response = await fetchImplementation(target.url, networkInit);

      if (!REDIRECT_STATUSES.has(response.status)) {
        return { response, release, finalUrl: target.url, redirects };
      }

      const location = response.headers.get('location');
      if (!location) {
        return { response, release, finalUrl: target.url, redirects };
      }
      if (!resolveTarget) {
        await response.body?.cancel().catch(() => undefined);
        await release();
        throw new FetchRedirectError(
          'Redirect rejected because no outbound validator is configured',
        );
      }
      if (redirects >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined);
        await release();
        throw new FetchRedirectError(`Redirect limit ${maxRedirects} exceeded`);
      }

      let nextUrl: URL;
      try {
        nextUrl = parseRedirectUrl(location, target.url);
        currentInit = createRedirectInit(
          currentInit,
          response.status,
          target.url,
          nextUrl,
          allowInsecureRedirects,
        );
      } catch (error: unknown) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      currentUrl = nextUrl;
      redirects += 1;
      await response.body?.cancel().catch(() => undefined);
      await release();
    } catch (error: unknown) {
      await release();
      throw normalizeFetchError(error, signal);
    }
  }
}

function createRedirectInit(
  init: RequestInit,
  status: number,
  previousUrl: URL,
  nextUrl: URL,
  allowInsecureRedirects: boolean,
): RequestInit {
  if (
    previousUrl.protocol === 'https:' &&
    nextUrl.protocol === 'http:' &&
    !allowInsecureRedirects
  ) {
    throw new FetchRedirectError('HTTPS-to-HTTP redirects are not allowed');
  }

  const currentMethod = normalizeMethod(init.method);
  const switchToGet =
    (status === 303 && currentMethod !== 'GET' && currentMethod !== 'HEAD') ||
    ((status === 301 || status === 302) && currentMethod === 'POST');
  const headers = new Headers(init.headers);

  if (previousUrl.origin !== nextUrl.origin) {
    for (const name of Array.from(headers.keys())) {
      if (isSensitiveHeaderName(name)) headers.delete(name);
    }
  }

  if (switchToGet) {
    headers.delete('content-length');
    headers.delete('content-type');
    return { ...init, method: 'GET', body: null, headers };
  }

  if (init.body !== undefined && !isReplayableBody(init.body)) {
    throw new FetchRedirectError(
      `Cannot replay a streaming request body across HTTP ${status} redirect`,
    );
  }

  return { ...init, headers };
}

function combineSignals(
  policySignal: AbortSignal | undefined,
  requestSignal: AbortSignal | null | undefined,
): AbortSignal | undefined {
  if (policySignal && requestSignal) return AbortSignal.any([policySignal, requestSignal]);
  return policySignal ?? requestSignal ?? undefined;
}

function canRetryRequest(
  method: string,
  init: RequestInit | undefined,
  options: FetchPolicyOptions,
): boolean {
  if (init?.body !== undefined && !isReplayableBody(init.body)) return false;
  if (IDEMPOTENT_METHODS.has(method)) return true;
  if (options.retryNonIdempotent) return true;
  const headerName = options.idempotencyKeyHeader ?? 'Idempotency-Key';
  return new Headers(init?.headers).has(headerName);
}

function isReplayableBody(body: BodyInit | null): boolean {
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isNonRetryablePolicyError(error: Error): boolean {
  return (
    error instanceof FetchRedirectError ||
    error instanceof FetchTargetPolicyError ||
    error instanceof FetchResponseLimitError ||
    error instanceof FetchSseLimitError ||
    error instanceof FetchIdleTimeoutError ||
    error instanceof FetchTimeoutError
  );
}

function parseFetchUrl(value: string | URL): URL {
  try {
    return new URL(value.toString());
  } catch (error: unknown) {
    throw new FetchTargetPolicyError('Invalid URL format', { cause: error });
  }
}

function parseRedirectUrl(location: string, base: URL): URL {
  try {
    return new URL(location, base);
  } catch (error: unknown) {
    throw new FetchRedirectError('Redirect location is invalid', { cause: error });
  }
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? 'GET').toUpperCase();
}

function normalizeFetchError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return abortReason(signal);
  return error instanceof Error ? error : new Error(String(error));
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function calculateBackoff(attempt: number, base: number, max: number, jitter: boolean): number {
  const exponential = Math.min(max, base * Math.pow(2, attempt));
  return jitter ? Math.random() * exponential : exponential;
}

async function delayWithSignal(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return resolved;
}
