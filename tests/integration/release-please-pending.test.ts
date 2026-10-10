import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSafePendingRelease } from '../../scripts/check-release-please-pending.mjs';

const names = [
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh',
];

function prepared() {
  return {
    state: 'prepared-unpublished',
    version: '0.19.0',
    expectedTag: '@a2amesh/runtime-v0.19.0',
    gates: { releasePlease: false, publish: false, retainAssets: false },
    packages: names.map((name) => ({
      name,
      version: '0.19.0',
      versionExists: false,
      complete: false,
    })),
    blockers: [
      'Missing canonical tag @a2amesh/runtime-v0.19.0 for checked-out commit ' +
        'a'.repeat(40) +
        '.',
      ...names.map((name) => name + '@0.19.0 is missing from npm.'),
    ],
  };
}

describe('release-please pending-publication state', () => {
  it('no-ops only for the expected complete set of unpublished public packages', () => {
    expect(isSafePendingRelease(prepared())).toBe(true);
  });

  it('fails closed on partial publication, source drift or unexpected blockers', () => {
    const baseline = prepared();
    expect(isSafePendingRelease({ ...baseline, state: 'partial-publication' })).toBe(false);
    expect(isSafePendingRelease({ ...baseline, state: 'drifted' })).toBe(false);
    expect(
      isSafePendingRelease({ ...baseline, gates: { ...baseline.gates, releasePlease: true } }),
    ).toBe(false);
    expect(
      isSafePendingRelease({ ...baseline, blockers: [...baseline.blockers, 'Source drift'] }),
    ).toBe(false);
    expect(
      isSafePendingRelease({
        ...baseline,
        packages: baseline.packages.map((pkg, i) =>
          i === 0 ? { ...pkg, versionExists: true } : pkg,
        ),
      }),
    ).toBe(false);
  });

  it('uses a narrow pending status with no changes to protected publication gates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a2amesh-release-pending-'));
    try {
      const input = join(directory, 'release-state.json');
      const summary = join(directory, 'summary.md');
      const script = new URL('../../scripts/check-release-please-pending.mjs', import.meta.url);
      writeFileSync(input, JSON.stringify(prepared()));
      const accepted = spawnSync(process.execPath, [script.pathname, input], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      });
      expect(accepted.status).toBe(0);
      expect(accepted.stdout).toContain('pending publication');
      expect(readFileSync(summary, 'utf8')).toContain('separate protected Publish workflow');

      writeFileSync(input, JSON.stringify({ ...prepared(), state: 'partial-publication' }));
      const rejected = spawnSync(process.execPath, [script.pathname, input], {
        encoding: 'utf8',
      });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('unexpected blockers');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('guards both downstream steps and retains the underlying fail-closed CLI mode', async () => {
    const { readFile } = await import('node:fs/promises');
    const workflow = await readFile(
      new URL('../../.github/workflows/release-please.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('node scripts/release-state.mjs --mode release-please --json');
    expect(workflow).toContain('node scripts/check-release-please-pending.mjs');
    expect(workflow).toMatch(
      /name: Verify published component tags\n\s+if: steps\.release_gate\.outputs\.resume == 'true'/,
    );
    expect(workflow).toMatch(
      /name: Create or update release pull request\n\s+if: steps\.release_gate\.outputs\.resume == 'true'/,
    );
  });
});
