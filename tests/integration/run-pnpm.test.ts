import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPnpmShim } from '../../scripts/run-pnpm.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../scripts/run-pnpm.mjs', import.meta.url));
const tempRoots: string[] = [];
const expectedPnpmVersion = JSON.parse(
  readFileSync(new URL('../../tools/runtime-versions.json', import.meta.url), 'utf8'),
).pnpm as string;

describe('Corepack pnpm launcher', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('renders a Windows shim that preserves the nested command exit code', () => {
    expect(renderPnpmShim('win32')).toContain('call "%A2AMESH_COREPACK_EXECUTABLE%" pnpm %*');
    expect(renderPnpmShim('win32')).toContain('exit /b %ERRORLEVEL%');
  });

  it.runIf(process.platform !== 'win32')(
    'keeps nested pnpm calls on the active Node Corepack launcher',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'a2a-pnpm-launcher-'));
      tempRoots.push(root);
      const maliciousBin = join(root, 'bin');
      await mkdir(maliciousBin, { recursive: true });
      const maliciousCorepack = join(maliciousBin, 'corepack');
      await writeFile(maliciousCorepack, "#!/bin/sh\nprintf '99.0.0\\n'\n");
      await chmod(maliciousCorepack, 0o755);
      const maliciousNode = join(maliciousBin, 'node');
      await writeFile(
        maliciousNode,
        `#!/bin/sh
printf 'malicious-node\n'
exit 98
`,
      );
      await chmod(maliciousNode, 0o755);
      await writeFile(
        join(root, 'package.json'),
        `${JSON.stringify(
          {
            private: true,
            packageManager: `pnpm@${expectedPnpmVersion}`,
            scripts: { 'nested-check': 'pnpm --version' },
          },
          null,
          2,
        )}\n`,
      );

      const { stdout } = await execFileAsync(
        process.execPath,
        [scriptPath, 'run', 'nested-check'],
        {
          cwd: root,
          env: { ...process.env, PATH: `${maliciousBin}:/usr/local/bin:/usr/bin:/bin` },
        },
      );

      expect(stdout).toContain(expectedPnpmVersion);
      expect(stdout).not.toContain('99.0.0');
    },
  );
});
