import { promises as dns } from 'node:dns';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard } from '@a2amesh/runtime';
import { createTrustCommand } from '../src/commands/trust.js';
import { runCli } from '../src/index.js';
import { commandNames, expectCommandHelp, jsonOptions } from './command-test-helpers.js';

function createAgentCard(): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Trust Test Agent',
    description: 'trust command test fixture',
    url: 'http://localhost:4100',
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [{ id: 'skill-1', name: 'Test', description: 'test skill' }],
  };
}

function createEs256KeyFiles() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function captureStdout(): { read: () => string } {
  let stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  return { read: () => stdout };
}

describe('trust command', () => {
  beforeEach(() => {
    vi.spyOn(dns, 'resolve').mockResolvedValue(['93.184.216.34']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('defines the trust command group and subcommands', () => {
    const command = createTrustCommand(jsonOptions);

    expect(command.name()).toBe('trust');
    expect(commandNames(command)).toEqual(['sign', 'verify', 'log']);
    expectCommandHelp(command, ['sign', 'verify', 'log']);
  });

  it('signs an Agent Card and verifies it against the matching public key', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-trust-'));
    const cardPath = join(tempDir, 'agent-card.json');
    const signedPath = join(tempDir, 'agent-card.signed.json');
    const keyPath = join(tempDir, 'signing-key.pem');
    const publicKeyPath = join(tempDir, 'public-key.pem');
    const { privateKeyPem, publicKeyPem } = createEs256KeyFiles();
    await writeFile(cardPath, JSON.stringify(createAgentCard()), 'utf8');
    await writeFile(keyPath, privateKeyPem, 'utf8');
    await writeFile(publicKeyPath, publicKeyPem, 'utf8');

    const signStdout = captureStdout();
    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'sign',
      cardPath,
      '--key',
      keyPath,
      '--key-id',
      'test-key',
      '--alg',
      'ES256',
      '--output',
      signedPath,
    ]);
    expect(process.exitCode).toBeUndefined();
    const signResult = JSON.parse(signStdout.read()) as { output: string; cardHash: string };
    expect(signResult.output).toBe(signedPath);
    expect(signResult.cardHash).toEqual(expect.any(String));

    const signedCard = JSON.parse(await readFile(signedPath, 'utf8')) as AgentCard;
    expect(signedCard.signatures).toHaveLength(1);
    expect(signedCard.signatures?.[0]?.keyId).toBe('test-key');

    vi.restoreAllMocks();
    const verifyStdout = captureStdout();
    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'verify',
      signedPath,
      '--trusted-key',
      `test-key:${publicKeyPath}`,
    ]);
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(verifyStdout.read())).toMatchObject({
      valid: true,
      verifiedKeyId: 'test-key',
    });
  });

  it('sets a non-zero exit code when verifying a tampered Agent Card', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-trust-tamper-'));
    const cardPath = join(tempDir, 'agent-card.json');
    const signedPath = join(tempDir, 'agent-card.signed.json');
    const keyPath = join(tempDir, 'signing-key.pem');
    const publicKeyPath = join(tempDir, 'public-key.pem');
    const { privateKeyPem, publicKeyPem } = createEs256KeyFiles();
    await writeFile(cardPath, JSON.stringify(createAgentCard()), 'utf8');
    await writeFile(keyPath, privateKeyPem, 'utf8');
    await writeFile(publicKeyPath, publicKeyPem, 'utf8');

    captureStdout();
    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'sign',
      cardPath,
      '--key',
      keyPath,
      '--key-id',
      'test-key',
      '--output',
      signedPath,
    ]);

    const tamperedCard = JSON.parse(await readFile(signedPath, 'utf8')) as AgentCard;
    tamperedCard.description = 'tampered description';
    await writeFile(signedPath, JSON.stringify(tamperedCard), 'utf8');

    vi.restoreAllMocks();
    const verifyStdout = captureStdout();
    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'verify',
      signedPath,
      '--trusted-key',
      `test-key:${publicKeyPath}`,
    ]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(verifyStdout.read())).toMatchObject({ valid: false });
  });

  it('fetches trust log entries from a registry', async () => {
    const stdout = captureStdout();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      expect(url).toBe('http://registry.test/trust-log?limit=10');
      return new Response(
        JSON.stringify([
          {
            sequence: 0,
            cardHash: 'hash-1',
            keyId: 'key-1',
            algorithm: 'ES256',
            agentUrl: 'http://agent-1',
            timestamp: '2026-07-06T00:00:00.000Z',
            entryHash: 'entry-hash-1',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'log',
      '--url',
      'http://registry.test',
      '--limit',
      '10',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.read())).toEqual([
      expect.objectContaining({ sequence: 0, cardHash: 'hash-1', keyId: 'key-1' }),
    ]);
  });

  it('filters the trust log route by card hash when --card is provided', async () => {
    const stdout = captureStdout();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      expect(url).toBe('http://registry.test/trust-log/hash-1');
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'trust',
      'log',
      '--url',
      'http://registry.test',
      '--card',
      'hash-1',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.read())).toEqual([]);
  });
});
