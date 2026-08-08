import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/check-doc-current-state.mjs', import.meta.url),
);
const tempRoots: string[] = [];

const canonicalRoadmapLink = '<a href="ROADMAP.md">Roadmap</a>';
const historicalSnapshot = `# A2A Mesh Open Issues Triage & Roadmap

> **Historical snapshot — observed 2026-06-27.** This document preserves migration-era issue triage and is not the current roadmap or issue/milestone source of truth. See the [current roadmap](../../ROADMAP.md).

**Date**: 2026-06-27
**Status**: Historical repository-backup triage snapshot
`;

describe('current documentation state contract', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('accepts the canonical roadmap link and explicitly historical triage snapshot', async () => {
    const root = await createWorkspace(canonicalRoadmapLink, historicalSnapshot);
    await expect(runCheck(root)).resolves.toBeDefined();
  });

  it('rejects a prominent Roadmap link that points at the dated triage snapshot', async () => {
    const root = await createWorkspace(
      '<a href="docs/roadmap/open-issues-triage-2026-06-27.md">Roadmap</a>',
      historicalSnapshot,
    );
    await expect(runCheck(root)).rejects.toMatchObject({
      stderr: expect.stringContaining('README.md: prominent Roadmap link must target ROADMAP.md'),
    });
  });

  it('rejects historical triage content that is not explicitly marked non-current', async () => {
    const root = await createWorkspace(
      canonicalRoadmapLink,
      '# A2A Mesh Open Issues Triage & Roadmap\n\n**Date**: 2026-06-27\n**Status**: 71 Open Issues Triaged from Repository Backup\n',
    );
    await expect(runCheck(root)).rejects.toMatchObject({
      stderr: expect.stringContaining('historical snapshot must be explicitly marked non-current'),
    });
  });
});

async function createWorkspace(readme: string, historical: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-doc-current-state-'));
  tempRoots.push(root);
  await writeFixture(root, 'README.md', `${readme}\n`);
  await writeFixture(root, 'docs/roadmap/open-issues-triage-2026-06-27.md', historical);
  return root;
}

async function writeFixture(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function runCheck(cwd: string) {
  return execFileAsync('node', [scriptPath], { cwd });
}
