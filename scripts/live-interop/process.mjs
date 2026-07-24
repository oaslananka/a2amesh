import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { redactText } from './report.mjs';

export const MAX_CAPTURE_BYTES = 16 * 1024;
const STOP_GRACE_MS = 2_000;

const BASE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'NODE_OPTIONS',
  'CI',
];

function buildEnvironment(extra = {}) {
  const environment = {};
  for (const key of BASE_ENV_KEYS) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...extra };
}

function appendBounded(current, chunk) {
  const combined = Buffer.concat([Buffer.from(current), Buffer.from(chunk)]);
  return combined.subarray(Math.max(0, combined.length - MAX_CAPTURE_BYTES)).toString('utf8');
}

export class ParticipantStartupError extends Error {
  constructor(participant, reason, diagnostics) {
    super(`Participant ${participant} failed to become ready: ${reason}`);
    this.name = 'ParticipantStartupError';
    this.participant = participant;
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export function startParticipant(options) {
  const startedAt = Date.now();
  const secrets = options.secrets ?? [];
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let signal = null;
  let stopped = false;
  let closed = false;
  let ready = false;
  let stdoutRemainder = '';

  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: buildEnvironment(options.env),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const diagnostics = () => ({
    participant: options.name,
    command: options.command,
    args: options.args ?? [],
    exitCode,
    signal,
    elapsedMs: Date.now() - startedAt,
    stdout: redactText(stdout, secrets),
    stderr: redactText(stderr, secrets),
  });

  const rejectStartup = (reason) => {
    if (ready) return;
    ready = true;
    rejectReady(new ParticipantStartupError(options.name, reason, diagnostics()));
  };

  const consumeLines = (chunk) => {
    stdoutRemainder += chunk.toString('utf8');
    const lines = stdoutRemainder.split(/\r?\n/);
    stdoutRemainder = lines.pop() ?? '';
    for (const line of lines) {
      if (ready || line.trim().length === 0) continue;
      try {
        const value = JSON.parse(line);
        if (value?.type === 'ready') {
          ready = true;
          clearTimeout(startupTimer);
          resolveReady(value);
        }
      } catch {
        // Readiness is intentionally signaled only by a structured JSON line.
      }
    }
  };

  child.stdout.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk);
    consumeLines(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  child.once('error', () => rejectStartup('spawn-error'));
  child.once('exit', (code, exitSignal) => {
    exitCode = code;
    signal = exitSignal;
    clearTimeout(startupTimer);
  });
  child.once('close', (code, exitSignal) => {
    closed = true;
    exitCode ??= code;
    signal ??= exitSignal;
    if (!ready) {
      rejectStartup('exited-before-ready');
    }
  });

  const startupTimer = setTimeout(() => {
    rejectStartup('startup-timeout');
    void stop();
  }, options.startupTimeoutMs ?? 10_000);
  startupTimer.unref?.();

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(startupTimer);
    if (closed) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      await once(child, 'close').catch(() => undefined);
      return;
    }

    child.kill('SIGTERM');
    const gracefulExit = once(child, 'close').then(() => true);
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), STOP_GRACE_MS);
      timer.unref?.();
    });
    if (!(await Promise.race([gracefulExit, timeout]))) {
      child.kill('SIGKILL');
      await once(child, 'close').catch(() => undefined);
    }
  }

  return {
    pid: child.pid,
    waitUntilReady: () => readyPromise,
    stop,
    diagnostics,
  };
}
