import { promises as dns } from 'node:dns';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistryCommand } from '../src/commands/registry.js';
import { runCli } from '../src/index.js';
import { commandNames, expectCommandHelp, jsonOptions } from './command-test-helpers.js';

const registryDocument = {
  $schema: 'https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json',
  schemaVersion: '1',
  exportedAt: '2026-05-25T12:00:00.000Z',
  agents: [
    {
      id: 'agent-1',
      url: 'https://agent.example.com/a2a',
      card: {
        protocolVersion: '1.0',
        name: 'Agent',
        description: 'desc',
        url: 'https://agent.example.com/a2a',
        version: '1.0',
      },
      status: 'unknown',
      tags: [],
      skills: [],
      registeredAt: '2026-05-25T12:00:00.000Z',
      tenantId: 'tenant-a',
      isPublic: true,
    },
  ],
  metadata: {
    source: 'a2amesh-registry',
    agentCount: 1,
    tenants: ['tenant-a'],
    publicAgents: 1,
  },
};

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function requestHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (input instanceof Request) {
    return input.headers;
  }
  return new Headers(init?.headers);
}

describe('registry command', () => {
  beforeEach(() => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('defines the registry command group and subcommands', () => {
    const command = createRegistryCommand(jsonOptions);

    expect(command.name()).toBe('registry');
    expect(commandNames(command)).toEqual(['start', 'list', 'export', 'import']);
    expectCommandHelp(command, [
      'Starts a local registry, lists registered agents',
      'start',
      'list',
      'export',
      'import',
    ]);
  });

  it('exports a versioned registry document to a JSON file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-registry-export-'));
    const outputPath = join(tempDir, 'registry.json');
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(toUrl(input)).toBe('http://registry.test/admin/agents/export');
      expect(requestHeaders(input, init).get('authorization')).toBe('Bearer registry-token');
      return new Response(JSON.stringify(registryDocument), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'registry',
      'export',
      '--url',
      'http://registry.test',
      '--output',
      outputPath,
      '--bearer-token',
      'registry-token',
    ]);

    const filePayload = JSON.parse(await readFile(outputPath, 'utf8')) as typeof registryDocument;
    const cliPayload = JSON.parse(stdout) as {
      output: string;
      schemaVersion: string;
      agentCount: number;
    };
    expect(process.exitCode).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(filePayload).toEqual(registryDocument);
    expect(cliPayload).toEqual({
      output: outputPath,
      schemaVersion: '1',
      agentCount: 1,
    });
  });

  it('imports a registry document from a JSON file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-registry-import-'));
    const inputPath = join(tempDir, 'registry.json');
    await writeFile(inputPath, JSON.stringify(registryDocument), 'utf8');
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(toUrl(input)).toBe('http://registry.test/admin/agents/import');
      expect(init?.method).toBe('POST');
      expect(requestHeaders(input, init).get('authorization')).toBe('Bearer registry-token');
      expect(JSON.parse(String(init?.body))).toEqual(registryDocument);
      return new Response(JSON.stringify({ imported: 1, updated: 0, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'registry',
      'import',
      '--url',
      'http://registry.test',
      '--input',
      inputPath,
      '--bearer-token',
      'registry-token',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout)).toEqual({ imported: 1, updated: 0, skipped: 0, total: 1 });
  });

  it('surfaces registry import authorization failures without leaking bearer tokens', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-registry-import-auth-'));
    const inputPath = join(tempDir, 'registry.json');
    await writeFile(inputPath, JSON.stringify(registryDocument), 'utf8');
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'registry',
      'import',
      '--url',
      'http://registry.test',
      '--input',
      inputPath,
      '--bearer-token',
      'registry-token',
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('Failed to import agents (401)');
    expect(stderr).not.toContain('registry-token');
  });
});
