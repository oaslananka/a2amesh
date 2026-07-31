import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);
const checker = new URL('../../scripts/check-agent-plugin.mjs', import.meta.url);
const tempRoots: string[] = [];

async function copyPluginFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-agent-plugin-'));
  tempRoots.push(root);

  const paths = [
    '.claude-plugin/plugin.json',
    '.mcp.json',
    '.codex/config.example.toml',
    '.vscode/mcp.example.json',
    'opencode.example.jsonc',
    '.opencode/skills',
    'docs/agent-plugin.md',
    'packages/cli/package.json',
    'packages/mcp/package.json',
    'skills',
  ];
  for (const path of paths) {
    const source = new URL(path, repoRoot);
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  return root;
}

describe('agent plugin publication contract', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('validates the product-owned plugin, skills, lifecycle, and publication gate', () => {
    const result = spawnSync(process.execPath, [checker.pathname], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Agent plugin validation passed.');
    expect(result.stderr).toBe('');
  });

  it('rejects a plugin bundle that omits the standalone MCP runtime configuration', async () => {
    const root = await copyPluginFixture();
    await rm(join(root, '.mcp.json'));

    const result = spawnSync(process.execPath, [checker.pathname, '--root', root], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.mcp.json');
  });

  it('rejects OpenCode skill drift from the canonical product skill', async () => {
    const root = await copyPluginFixture();
    const mirror = join(root, '.opencode/skills/a2a-endpoint-validation/SKILL.md');
    const current = await readFile(mirror, 'utf8');
    await writeFile(mirror, `${current}\nDrifted copy.\n`);

    const result = spawnSync(process.execPath, [checker.pathname, '--root', root], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OpenCode mirror differs');
  });
});
