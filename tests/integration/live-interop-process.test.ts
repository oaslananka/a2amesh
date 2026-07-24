import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CAPTURE_BYTES,
  ParticipantStartupError,
  startParticipant,
} from '../../scripts/live-interop/process.mjs';
import { redactDiagnostic, writeLiveInteropReport } from '../../scripts/live-interop/report.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const fixture = path.join(root, 'tests/integration/fixtures/live-interop-child.mjs');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((fn) => fn()));
});

describe('live interop process supervisor', () => {
  it('waits for a structured readiness event and stops the child', async () => {
    const participant = startParticipant({
      name: 'ready-fixture',
      command: process.execPath,
      args: [fixture, 'ready'],
      cwd: root,
      startupTimeoutMs: 2_000,
    });
    cleanup.push(() => participant.stop());

    await expect(participant.waitUntilReady()).resolves.toEqual({
      type: 'ready',
      url: 'http://127.0.0.1:43123',
    });

    await participant.stop();
    expect(participant.diagnostics().exitCode).toBe(0);
  });

  it('fails with bounded diagnostics when readiness times out', async () => {
    const participant = startParticipant({
      name: 'hanging-fixture',
      command: process.execPath,
      args: [fixture, 'hang'],
      cwd: root,
      startupTimeoutMs: 50,
    });
    cleanup.push(() => participant.stop());

    await expect(participant.waitUntilReady()).rejects.toMatchObject({
      name: 'ParticipantStartupError',
      participant: 'hanging-fixture',
      reason: 'startup-timeout',
    } satisfies Partial<ParticipantStartupError>);
  });

  it('reports a non-zero exit before readiness', async () => {
    const participant = startParticipant({
      name: 'failing-fixture',
      command: process.execPath,
      args: [fixture, 'fail'],
      cwd: root,
      startupTimeoutMs: 2_000,
    });

    await expect(participant.waitUntilReady()).rejects.toMatchObject({
      name: 'ParticipantStartupError',
      participant: 'failing-fixture',
      reason: 'exited-before-ready',
    } satisfies Partial<ParticipantStartupError>);
    expect(participant.diagnostics()).toMatchObject({
      exitCode: 7,
      stderr: expect.stringContaining('participant failed before readiness'),
    });
  });

  it('stops promptly after a participant has already closed', async () => {
    const participant = startParticipant({
      name: 'closed-fixture',
      command: process.execPath,
      args: [fixture, 'fail'],
      cwd: root,
      startupTimeoutMs: 2_000,
    });

    await expect(participant.waitUntilReady()).rejects.toBeInstanceOf(ParticipantStartupError);
    await expect(participant.stop()).resolves.toBeUndefined();
  });

  it('bounds captured output and redacts credentials', async () => {
    const secret = 'live-interop-secret-value';
    const participant = startParticipant({
      name: 'secret-fixture',
      command: process.execPath,
      args: [fixture, 'secret-output'],
      cwd: root,
      env: { LIVE_INTEROP_TEST_SECRET: secret },
      secrets: [secret],
      startupTimeoutMs: 2_000,
    });

    await expect(participant.waitUntilReady()).rejects.toBeInstanceOf(ParticipantStartupError);
    const diagnostics = participant.diagnostics();
    expect(Buffer.byteLength(diagnostics.stderr)).toBeLessThanOrEqual(MAX_CAPTURE_BYTES);
    expect(diagnostics.stderr).not.toContain(secret);
    expect(diagnostics.stderr).not.toContain('Bearer');
    expect(diagnostics.stderr).not.toContain('session=');
    expect(diagnostics.stderr).toContain('[REDACTED]');
  });
});

describe('live interop report helpers', () => {
  it('redacts nested diagnostic values', () => {
    const value = {
      headers: {
        Authorization: 'Bearer token-value',
        'x-api-key': 'api-key-value',
        Cookie: 'session=cookie-value',
      },
      message: 'request failed with token-value',
    };

    expect(redactDiagnostic(value, ['token-value', 'api-key-value', 'cookie-value'])).toEqual({
      headers: {
        Authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
        Cookie: '[REDACTED]',
      },
      message: 'request failed with [REDACTED]',
    });
  });

  it('writes a stable JSON report under artifacts', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'a2amesh-live-report-'));
    cleanup.push(() => rm(tempRoot, { recursive: true, force: true }));

    const reportPath = await writeLiveInteropReport(tempRoot, {
      schemaVersion: '2026-07-23',
      mode: 'live-sdk',
      status: 'passed',
      scenarios: [],
    });

    expect(reportPath).toBe(path.join(tempRoot, 'artifacts/interop-live/report.json'));
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('"mode": "live-sdk"');
  });
});
