import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';

const redisUrl = process.env['A2AMESH_TEST_REDIS_URL'] ?? '';
const workerPath = fileURLToPath(
  new URL('./fixtures/idempotency-redis-worker.mjs', import.meta.url),
);

interface WorkerResult {
  type: 'result';
  outcome: string;
  state: string;
}

interface WorkerError {
  type: 'error';
  error: string;
}

describe.runIf(redisUrl.length > 0)('Redis idempotency multi-process ownership', () => {
  it('grants one lease across independent Node.js processes', async () => {
    await clearRedis();
    const results = await runWorkers([
      { key: 'same-key', fingerprint: 'same-fingerprint', leaseMs: 5_000 },
      { key: 'same-key', fingerprint: 'same-fingerprint', leaseMs: 5_000 },
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(['acquired', 'in-progress']);
  });

  it('rejects a conflicting fingerprint across independent processes', async () => {
    await clearRedis();
    const results = await runWorkers([
      { key: 'conflict-key', fingerprint: 'fingerprint-a', leaseMs: 5_000 },
      { key: 'conflict-key', fingerprint: 'fingerprint-b', leaseMs: 5_000 },
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(['acquired', 'conflict']);
  });

  it('recovers an abandoned lease and replays a completed result', async () => {
    await clearRedis();
    const [abandoned] = await runWorkers([
      { key: 'recovery-key', fingerprint: 'fingerprint', leaseMs: 500 },
    ]);
    expect(abandoned?.outcome).toBe('acquired');

    await new Promise((resolve) => setTimeout(resolve, 650));
    const [conflict] = await runWorkers([
      { key: 'recovery-key', fingerprint: 'different-fingerprint', leaseMs: 500 },
    ]);
    expect(conflict?.outcome).toBe('conflict');

    const [recovered] = await runWorkers([
      { key: 'recovery-key', fingerprint: 'fingerprint', leaseMs: 500, complete: true },
    ]);
    expect(recovered?.outcome).toBe('recovered');

    const [replay] = await runWorkers([
      { key: 'recovery-key', fingerprint: 'fingerprint', leaseMs: 500 },
    ]);
    expect(replay).toMatchObject({ outcome: 'replay', state: 'completed' });
  });
});

interface WorkerInput {
  key: string;
  fingerprint: string;
  leaseMs: number;
  complete?: boolean;
}

async function runWorkers(inputs: WorkerInput[]): Promise<WorkerResult[]> {
  const workers = inputs.map(() =>
    fork(workerPath, {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }),
  );
  try {
    await Promise.all(workers.map(waitForReady));
    return await Promise.all(
      workers.map((worker, index) => {
        const input = inputs[index]!;
        const result = waitForResult(worker);
        worker.send({
          redisUrl,
          scope: 'rpc:message/send:tenant:principal:apiKey',
          ...input,
        });
        return result;
      }),
    );
  } finally {
    for (const worker of workers) worker.kill('SIGTERM');
  }
}

function waitForReady(worker: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (message: { type?: string }): void => {
      if (message.type !== 'ready') return;
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`Redis worker exited before ready (code=${code}, signal=${signal})`));
    };
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  });
}

function waitForResult(worker: ChildProcess): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (message: WorkerResult | WorkerError): void => {
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.error));
        return;
      }
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`Redis worker exited before result (code=${code}, signal=${signal})`));
    };
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  });
}

async function clearRedis(): Promise<void> {
  const client = createClient({ url: redisUrl });
  await client.connect();
  try {
    await client.flushDb();
  } finally {
    await client.quit();
  }
}
