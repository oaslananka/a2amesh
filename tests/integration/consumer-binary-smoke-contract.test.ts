import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('cross-platform installed binary smoke contract', () => {
  it('executes Registry and MCP package binaries from the installed consumer project', async () => {
    const source = await readFile(
      new URL('../../scripts/run-consumer-smoke.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('registry binary / a2amesh-registry');
    expect(source).toContain('mcp binary / a2amesh-mcp');
    expect(source).toContain("join(binDir, 'a2amesh-registry.cmd')");
    expect(source).toContain("join(binDir, 'a2amesh-mcp.cmd')");
    expect(source).toContain("['--help']");
  });

  it('uses stdio:inherit for build and pack to avoid ENOBUFS', async () => {
    const source = await readFile(
      new URL('../../scripts/run-consumer-smoke.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('runPnpmStream');
    expect(source).toContain('stdio: \'inherit\'');
    expect(source).toContain('function runStream');
    expect(source).toContain('function runPnpmStream');
  });
});

describe('run-consumer-smoke behavioral regression', () => {
  it('handles large output without ENOBUFS via runStream', () => {
    // Use a command that produces large output (yes | head -c 10MB)
    // This simulates the pnpm build output volume
    const result = spawnSync(process.execPath, [
      '-e',
      `
      const { execFileSync } = require('child_process');
      function runStream(cmd, args) {
        if (process.platform === 'win32') {
          return execFileSync('cmd', ['/c', cmd, ...args], { stdio: 'inherit', encoding: 'utf-8' });
        }
        return execFileSync(cmd, args, { stdio: 'inherit', encoding: 'utf-8' });
      }
      // Produce ~10MB of output
      runStream('sh', ['-c', 'yes | head -c 10485760']);
      `,
    ], { encoding: 'utf-8', timeout: 30000, stdio: 'inherit' });

    // Should not crash with ENOBUFS
    expect(result.error?.code).not.toBe('ENOBUFS');
    // Exit code should be 0 (success)
    expect(result.status).toBe(0);
  });

  it('propagates non-zero exit codes from runStream', () => {
    const result = spawnSync(process.execPath, [
      '-e',
      `
      const { execFileSync } = require('child_process');
      function runStream(cmd, args) {
        if (process.platform === 'win32') {
          return execFileSync('cmd', ['/c', cmd, ...args], { stdio: 'inherit', encoding: 'utf-8' });
        }
        return execFileSync(cmd, args, { stdio: 'inherit', encoding: 'utf-8' });
      }
      try {
        runStream('sh', ['-c', 'exit 42']);
      } catch (e) {
        process.exit(e.status ?? 1);
      }
      `,
    ], { encoding: 'utf-8', timeout: 10000 });

    // Should propagate the exit code
    expect(result.status).toBe(42);
  });

  it('propagates non-zero exit codes from run (pipe mode)', () => {
    const result = spawnSync(process.execPath, [
      '-e',
      `
      const { execFileSync } = require('child_process');
      function run(cmd, args) {
        if (process.platform === 'win32') {
          return execFileSync('cmd', ['/c', cmd, ...args], { stdio: 'pipe', encoding: 'utf-8' });
        }
        return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8' });
      }
      try {
        run('sh', ['-c', 'exit 99']);
      } catch (e) {
        process.exit(e.status ?? 1);
      }
      `,
    ], { encoding: 'utf-8', timeout: 10000 });

    expect(result.status).toBe(99);
  });
});