import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../scripts/release-state.mjs', import.meta.url));
const tempRoots: string[] = [];
const packageNames = [
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh',
];

type FixtureOptions = {
  mode?: 'report' | 'release-please' | 'publish';
  tagCommit?: string | null;
  npmPublished?: string[];
  openReleaseVersion?: string;
  npmFailure?: string;
};

describe.skipIf(process.platform === 'win32')('release-state CLI', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('blocks release-please mode when the prepared version is unpublished', async () => {
    const result = await runFixture({ mode: 'release-please', npmPublished: [], tagCommit: null });

    expect(result.exitCode).toBe(1);
    expect(result.json.state).toBe('prepared-unpublished');
    expect(result.json.gates.releasePlease).toBe(false);
  });

  it('permits publish mode with a matching tag and a newer release PR', async () => {
    const result = await runFixture({
      mode: 'publish',
      npmPublished: [],
      tagCommit: 'abc123',
      openReleaseVersion: '0.12.0-alpha.1',
    });

    expect(result.exitCode).toBe(0);
    expect(result.json.state).toBe('prepared-unpublished');
    expect(result.json.gates.publish).toBe(true);
  });

  it('returns unavailable when npm cannot be observed', async () => {
    const result = await runFixture({ npmFailure: 'ETIMEDOUT' });

    expect(result.exitCode).toBe(0);
    expect(result.json.state).toBe('unavailable');
    expect(result.json.blockers).toContainEqual(expect.stringContaining('ETIMEDOUT'));
  });
});

async function runFixture(options: FixtureOptions) {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-release-state-'));
  tempRoots.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });

  const manifest = Object.fromEntries(
    packageNames.map((name) => [`packages/${name.split('/')[1]}`, '0.11.0-alpha.1']),
  );
  const packages = Object.fromEntries(
    packageNames.map((name) => [
      `packages/${name.split('/')[1]}`,
      { 'package-name': name, component: name },
    ]),
  );
  await writeFile(join(root, '.release-please-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'release-please-config.json'), JSON.stringify({ packages }));
  for (const name of packageNames) {
    const dir = join(root, 'packages', name.split('/')[1]);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, version: '0.11.0-alpha.1', publishConfig: { access: 'public' } }),
    );
  }

  const published = new Set(options.npmPublished ?? packageNames);
  const fixture = {
    head: 'abc123',
    tagCommit: options.tagCommit === undefined ? 'abc123' : options.tagCommit,
    openReleaseVersion: options.openReleaseVersion ?? null,
    npmFailure: options.npmFailure ?? null,
    npm: Object.fromEntries(
      packageNames.map((name) => [
        name,
        {
          published: published.has(name),
          distTags: {
            latest: '0.1.0-alpha.1',
            ...(published.has(name) ? { alpha: '0.11.0-alpha.1' } : {}),
          },
        },
      ]),
    ),
  };
  const fixturePath = join(root, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(fixture));

  for (const command of ['git', 'gh', 'npm']) {
    const commandPath = join(bin, command);
    await writeFile(commandPath, fakeCommandSource(command));
    await chmod(commandPath, 0o755);
  }

  const args = ['--mode', options.mode ?? 'report', '--json'];
  if (options.mode === 'publish' && fixture.tagCommit) {
    args.push('--tag', '@a2amesh/runtime-v0.11.0-alpha.1');
  }
  try {
    const result = await execFileAsync('node', [scriptPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        FIXTURE_CONFIG: fixturePath,
        GITHUB_REPOSITORY: 'oaslananka/a2amesh',
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      },
    });
    return { exitCode: 0, json: parseJson(result.stdout) };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.code ?? 1,
      json: parseJson(failure.stdout),
      stderr: failure.stderr ?? '',
    };
  }
}

function parseJson(value?: string) {
  return value?.trim() ? JSON.parse(value) : {};
}

function fakeCommandSource(command: string) {
  return `#!/usr/bin/env node
const fs = require('node:fs');
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE_CONFIG, 'utf8'));
const args = process.argv.slice(2);
const command = ${JSON.stringify(command)};
function out(value) { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); }
if (command === 'git') {
  if (args[0] === 'remote') out('https://github.com/oaslananka/a2amesh.git\\n');
  else if (args[0] === 'rev-parse' && args[1] === 'HEAD') out(fixture.head + '\\n');
  else if (args[0] === 'rev-parse' && args[1].endsWith('^{commit}')) {
    if (fixture.tagCommit) out(fixture.tagCommit + '\\n'); else process.exit(1);
  } else process.exit(2);
} else if (command === 'gh') {
  if (args[0] === 'pr' && args[1] === 'list') {
    out(fixture.openReleaseVersion ? [{ number: 156, title: 'chore: release main', url: 'https://example.test/156', headRefName: 'release-please--branches--main', headRefOid: 'prsha' }] : []);
  } else if (args[0] === 'api') {
    const version = fixture.openReleaseVersion;
    const manifest = Object.fromEntries(${JSON.stringify(packageNames)}.map((name) => ['packages/' + name.split('/')[1], version]));
    out({ content: Buffer.from(JSON.stringify(manifest)).toString('base64') });
  } else process.exit(2);
} else if (command === 'npm') {
  if (fixture.npmFailure) {
    process.stderr.write(fixture.npmFailure + '\\n');
    process.exit(1);
  }
  const target = args[1];
  if (args[0] !== 'view') process.exit(2);
  if (args[2] === 'version') {
    const marker = target.lastIndexOf('@');
    const name = target.slice(0, marker);
    const version = target.slice(marker + 1);
    if (fixture.npm[name]?.published) out(JSON.stringify(version));
    else { process.stderr.write('npm error code E404\\n'); process.exit(1); }
  } else if (args[2] === 'dist-tags') {
    out(fixture.npm[target].distTags);
  } else process.exit(2);
}
`;
}
