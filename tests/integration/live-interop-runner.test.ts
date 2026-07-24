import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseLiveInteropArgs,
  runScenarioMatrix,
  selectLiveInteropScenarios,
  type LiveInteropScenarioDefinition,
} from '../../scripts/live-interop/runner.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((fn) => fn()));
});

describe('live interop runner', () => {
  it('parses ecosystem, check, and report arguments', () => {
    expect(
      parseLiveInteropArgs([
        '--',
        '--check',
        '--ecosystem',
        'javascript',
        '--report',
        'artifacts/custom.json',
      ]),
    ).toEqual({
      check: true,
      ecosystem: 'javascript',
      report: 'artifacts/custom.json',
    });
    expect(parseLiveInteropArgs([])).toEqual({
      check: false,
      ecosystem: 'all',
      report: 'artifacts/interop-live/report.json',
    });
  });

  it('selects the required four directions and the negative version scenario', () => {
    expect(selectLiveInteropScenarios('javascript').map((scenario) => scenario.id)).toEqual([
      'official-javascript-client-to-mesh',
      'mesh-client-to-official-javascript',
      'negative-protocol-version',
    ]);
    expect(selectLiveInteropScenarios('python').map((scenario) => scenario.id)).toEqual([
      'official-python-client-to-mesh',
      'mesh-client-to-official-python',
    ]);
    expect(selectLiveInteropScenarios('all')).toHaveLength(5);
  });

  it('aggregates scenario results and redacts failure diagnostics', async () => {
    const scenarios: LiveInteropScenarioDefinition[] = [
      {
        id: 'passing',
        ecosystem: 'javascript',
        direction: 'official-client->mesh-server',
      },
      {
        id: 'failing',
        ecosystem: 'python',
        direction: 'mesh-client->official-server',
      },
    ];
    const report = await runScenarioMatrix({
      scenarios,
      secrets: ['secret-value'],
      executeScenario: async (scenario) => {
        if (scenario.id === 'failing') {
          throw new Error('Authorization: Bearer secret-value');
        }
        return { state: 'passed' };
      },
    });

    expect(report.status).toBe('failed');
    expect(report.scenarios).toEqual([
      expect.objectContaining({ id: 'passing', status: 'passed' }),
      expect.objectContaining({
        id: 'failing',
        status: 'failed',
        error: expect.not.stringContaining('secret-value'),
      }),
    ]);
    expect(JSON.stringify(report)).toContain('[REDACTED]');
  });

  it('runs check mode without starting live participants and writes a report', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'a2amesh-live-runner-'));
    cleanup.push(() => rm(tempRoot, { recursive: true, force: true }));
    const reportPath = path.join(tempRoot, 'check-report.json');

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        path.join(root, 'scripts/run-live-interop.mjs'),
        '--check',
        '--ecosystem',
        'javascript',
        '--report',
        reportPath,
      ],
      {
        cwd: root,
        env: { PATH: process.env['PATH'], HOME: process.env['HOME'] },
        timeout: 15_000,
      },
    );

    expect(stdout).toContain('Live official SDK interop check passed');
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    expect(report).toMatchObject({
      mode: 'check',
      status: 'passed',
      ecosystem: 'javascript',
      protocolVersion: '1.0',
    });
    expect(report['scenarios']).toHaveLength(3);
  });
});
