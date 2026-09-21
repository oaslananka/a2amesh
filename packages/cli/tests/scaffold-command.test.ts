import { describe, expect, it } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScaffoldCommand, scaffoldAgent } from '../src/commands/scaffold.js';
import { expectCommandHelp } from './command-test-helpers.js';

describe('init command', () => {
  it('defines the init command and stable template options', () => {
    const command = createScaffoldCommand();

    expect(command.name()).toBe('init');
    expect(command.alias()).toBe('scaffold');
    expectCommandHelp(command, [
      'init|scaffold [options] <agent-name>',
      '--adapter <adapter>',
      '--template <template>',
      '--auth',
      '--rate-limit',
      '--docker',
    ]);
  });

  it('scaffolds a production-demo project with expected files and scripts', () => {
    const targetDir = join(process.cwd(), 'test-scaffold-demo');
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    try {
      scaffoldAgent('test-scaffold-demo', {
        adapter: 'custom',
        template: 'production-demo',
        auth: false,
        rateLimit: false,
        docker: false,
      });

      expect(existsSync(join(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'src/researcher-agent.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src/orchestrator-agent.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src/index.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'verify.mjs'))).toBe(true);
      expect(existsSync(join(targetDir, 'tests/demo.test.ts'))).toBe(true);

      const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'));
      expect(pkg.scripts.verify).toBe('tsx verify.mjs');
      expect(pkg.dependencies['@a2amesh/runtime']).toBeDefined();
      expect(pkg.dependencies['@a2amesh/registry']).toBeDefined();
      expect(pkg.dependencies['@a2amesh/mcp']).toBeDefined();
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it('scaffolds a custom agent with auth, rate-limit, and docker options', () => {
    const targetDir = join(process.cwd(), 'test-scaffold-custom');
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    try {
      scaffoldAgent('test-scaffold-custom', {
        adapter: 'custom',
        template: 'custom',
        auth: true,
        rateLimit: true,
        docker: true,
      });

      expect(existsSync(join(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'src/agent.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src/index.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'Dockerfile'))).toBe(true);

      const agentSrc = readFileSync(join(targetDir, 'src/agent.ts'), 'utf8');
      expect(agentSrc).toContain('auth:');
      expect(agentSrc).toContain('rateLimit:');
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it('handles createScaffoldCommand action execution for valid and invalid templates', () => {
    const command = createScaffoldCommand();
    command.exitOverride();

    const targetDemo = join(process.cwd(), 'cmd-scaffold-demo');
    if (existsSync(targetDemo)) {
      rmSync(targetDemo, { recursive: true, force: true });
    }

    try {
      expect(() =>
        command.parse(['node', 'test', 'cmd-scaffold-demo', '--template', 'production-demo']),
      ).not.toThrow();
      expect(existsSync(join(targetDemo, 'package.json'))).toBe(true);
    } finally {
      if (existsSync(targetDemo)) {
        rmSync(targetDemo, { recursive: true, force: true });
      }
    }

    const commandInvalid = createScaffoldCommand();
    commandInvalid.exitOverride();
    expect(() =>
      commandInvalid.parse(['node', 'test', 'cmd-invalid', '--template', 'invalid-template']),
    ).toThrow('Supported templates are custom and production-demo');
  });
});
