import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
});
