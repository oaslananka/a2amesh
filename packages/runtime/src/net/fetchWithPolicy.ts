import { logger } from '../utils/logger.js';
import { redactHeaders } from '../utils/redaction.js';
export { redactHeaders } from '../utils/redaction.js';
import { a2aMeshTracer, SpanStatusCode } from '../telemetry/index.js';

export type FetchTelemetryLabels = Record<string, string | number | boolean>;

export interface FetchPolicyOptions {
  /** Maximum time in milliseconds to wait for a single fetch attempt. Default: 30000 (30s) */
  timeoutMs?: number;
  /** Number of retry attempts for transient errors (5xx, network failures). Default: 0 */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 500 */
  backoffBaseMs?: number;
  /** Maximum delay in milliseconds for exponential backoff. Default: 10000 (10s) */
  backoffMaxMs?: number;
  /** Whether to add jitter to the backoff delay. Default: true */
  jitter?: boolean;
  /** AbortSignal to cancel the entire operation (including retries) */
  signal?: AbortSignal;
  /** Additional span attributes to attach to outbound HTTP telemetry. */
  telemetryLabels?: FetchTelemetryLabels;
}

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Calculates exponential backoff with optional full jitter.
 * delay = min(backoffMaxMs, backoffBaseMs * 2^attempt)
 * If jitter is true: delay = random(0, delay)
 */
function calculateBackoff(attempt: number, base: number, max: number, jitter: boolean): number {
  const exponential = Math.min(max, base * Math.pow(2, attempt));
  return jitter ? Math.random() * exponential : exponential;
}

/**
 * A robust fetch wrapper providing timeouts, `AbortController` integration,
 * idempotent exponential backoff retries with jitter, and telemetry/logging.
 */
export async function fetchWithPolicy(
  url: string | URL,
  init?: RequestInit,
  options: FetchPolicyOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxRetries = options.retries ?? 0;
  const backoffBaseMs = options.backoffBaseMs ?? 500;
  const backoffMaxMs = options.backoffMaxMs ?? 10000;
  const useJitter = options.jitter ?? true;

  const urlString = url.toString();
  const method = init?.method ?? 'GET';

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    if (options.signal?.aborted) {
      throw new Error('Operation aborted by user signal', { cause: options.signal.reason });
    }

    const span = a2aMeshTracer.startSpan('http.request', {
      attributes: {
        ...(options.telemetryLabels ?? {}),
        'http.method': method,
        'http.url': urlString,
        'http.attempt': attempt + 1,
        'http.max_retries': maxRetries,
      },
    });

    const controller = new AbortController();
    const abortListener = () => controller.abort(options.signal?.reason);

    if (options.signal) {
      options.signal.addEventListener('abort', abortListener);
    }

    const timeoutId = setTimeout(() => {
      controller.abort(new FetchTimeoutError(`Fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const mergedInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };

    try {
      logger.debug('Fetching URL', {
        url: urlString,
        method,
        headers: redactHeaders(init?.headers),
      });
      const response = await fetch(url, mergedInit);
      span.setAttribute('http.status_code', response.status);

      // Transient errors that might be worth retrying
      if (
        attempt < maxRetries &&
        (response.status === 408 || response.status === 429 || response.status >= 500)
      ) {
        logger.warn('Transient HTTP error, retrying...', {
          url: urlString,
          status: response.status,
          attempt: attempt + 1,
          maxRetries,
        });

        // Consume body to free socket before retry
        await response.text().catch(() => {});
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Transient error ${response.status}`,
        });
        span.end();
      } else {
        // Success or non-transient error (e.g. 400, 401, 404)
        if (!response.ok) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
        return response;
      }
    } catch (error: unknown) {
      lastError = error;
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Fetch failed',
      });
      span.end();

      const isAbortError = error instanceof DOMException && error.name === 'AbortError';
      const isTimeout =
        error instanceof FetchTimeoutError ||
        (isAbortError && controller.signal.reason instanceof FetchTimeoutError);
      const isUserAbort = isAbortError && options.signal?.aborted;

      if (isUserAbort) {
        logger.debug('Fetch aborted by user', { url: urlString });
        throw error;
      }

      if (attempt >= maxRetries) {
        logger.error('Fetch failed after max retries', {
          url: urlString,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      logger.warn('Fetch attempt failed, retrying...', {
        url: urlString,
        attempt: attempt + 1,
        isTimeout,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortListener);
      }
    }

    const delayMs = calculateBackoff(attempt, backoffBaseMs, backoffMaxMs, useJitter);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    attempt++;
  }

  throw lastError ?? new Error('Fetch failed with unknown error');
}
