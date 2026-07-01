/**
 * @file logger.ts
 * Small structured logger with request/task/context correlation support.
 */

import { redactRecord } from './redaction.js';

export interface LogContext {
  requestId?: string;
  traceId?: string;
  taskId?: string;
  contextId?: string;
  method?: string;
  agentName?: string;
  principalId?: string;
  tenantId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type ConfiguredLogLevel = LogLevel | 'silent';

const LOG_LEVELS: Record<ConfiguredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

function resolveLogLevel(): ConfiguredLogLevel {
  const level = process.env['LOG_LEVEL']?.toLowerCase();
  if (
    level === 'debug' ||
    level === 'info' ||
    level === 'warn' ||
    level === 'error' ||
    level === 'silent'
  ) {
    return level;
  }
  return 'info';
}

function isProductionMode(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { error: String(error) };
}

function formatPretty(level: LogLevel, message: string, context: LogContext): string {
  const contextEntries = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');

  return `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${
    contextEntries ? ` ${contextEntries}` : ''
  }`;
}

function writeLog(level: LogLevel, message: string, context: LogContext): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[resolveLogLevel()]) {
    return;
  }

  const redactedContext = redactRecord(context);
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactedContext,
  };

  const output = isProductionMode()
    ? JSON.stringify(payload)
    : formatPretty(level, message, redactedContext);

  if (level === 'error') {
    process.stderr.write(`${output}\n`);
    return;
  }

  process.stdout.write(`${output}\n`);
}

export const logger = {
  debug(message: string, context: LogContext = {}): void {
    writeLog('debug', message, context);
  },
  info(message: string, context: LogContext = {}): void {
    writeLog('info', message, context);
  },
  warn(message: string, context: LogContext = {}): void {
    writeLog('warn', message, context);
  },
  error(message: string, context: LogContext = {}): void {
    const normalizedContext = { ...context };
    if ('error' in normalizedContext) {
      normalizedContext['error'] = serializeError(normalizedContext['error']);
    }
    writeLog('error', message, normalizedContext);
  },
  /**
   * Logs a standardized audit event for compliance and security trails.
   */
  audit(
    action: string,
    principalId: string | undefined,
    targetResource: string,
    outcome: 'success' | 'failure',
    context: LogContext = {},
  ): void {
    writeLog('info', `AUDIT: ${action}`, {
      ...context,
      isAudit: true,
      action,
      principalId: principalId ?? 'anonymous',
      targetResource,
      outcome,
    });
  },
};
