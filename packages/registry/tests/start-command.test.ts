import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const registryEntry = resolve(repoRoot, 'packages', 'registry', 'dist', 'bin', 'start.js');

describe('registry process entrypoint', () => {
  it('prints startup configuration help without starting a listener', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [registryEntry, '--help'], {
      cwd: repoRoot,
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('Usage: a2amesh-registry');
    expect(stdout).toContain('REGISTRY_STORAGE_BACKEND');
    expect(stdout).toContain('A2A_TELEMETRY_ENABLED');
  });
});
