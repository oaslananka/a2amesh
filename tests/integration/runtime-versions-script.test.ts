import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/check-runtime-versions.mjs', import.meta.url),
);
const tempRoots: string[] = [];

const manifest = {
  node: '24.16.0',
  nodeCompatibility: ['22.22.3', '24.16.0'],
  nodeDockerAlpineDigest: 'sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14',
  pnpm: '11.2.2',
  npmForPublish: '11.15.0',
};

type RulesetEntry = { context: string; integration_id?: number };

describe('runtime version manifest checks', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('fails when CI compatibility matrix includes a Node version outside the runtime manifest', async () => {
    const workspace = await createRuntimeWorkspace({
      compatibilityRows: [
        { os: 'ubuntu-latest', runner: 'ubuntu-latest', node: '22.22.3' },
        { os: 'ubuntu-latest', runner: 'ubuntu-latest', node: '23.1.0' },
        { os: 'windows-latest', runner: 'windows-2025-vs2026', node: '24.16.0' },
        { os: 'macos-latest', runner: 'macos-latest', node: '24.16.0' },
      ],
    });

    await expect(execRuntimeCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('not present in tools/runtime-versions.json'),
    });
  });

  it('accepts compatibility matrix rows with reordered keys and trailing comments', async () => {
    const workspace = await createRuntimeWorkspace({
      compatibilityRowsYaml: `          - node: '22.22.3' # minimum supported LTS
            runner: ubuntu-latest
            os: ubuntu-latest
          - runner: windows-2025-vs2026
            node: '24.16.0' # primary supported LTS
            os: windows-latest
          - os: macos-latest
            node: '24.16.0' # primary supported LTS
            runner: macos-latest`,
    });

    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('writes and validates the deterministic mise and Corepack contract', async () => {
    const workspace = await createRuntimeWorkspace();
    await writeFixture(
      workspace,
      'mise.toml',
      `[tools]
node = "23.0.0"

[settings]
node.corepack = false
`,
    );
    await writeFixture(workspace, '.husky/pre-commit', 'pnpm run lint:staged\n');
    await writeFixture(workspace, '.husky/pre-push', 'pnpm run check:pre-push\n');
    const packagePath = join(workspace, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    packageJson.scripts.setup = 'pnpm install';
    delete packageJson.scripts['toolchain:check'];
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const ciPath = join(workspace, '.github/workflows/ci.yml');
    await writeFile(
      ciPath,
      (await readFile(ciPath, 'utf8')).replace(
        '      - run: corepack pnpm run toolchain:check\n',
        '',
      ),
    );

    await expect(execRuntimeCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('deterministic toolchain contract'),
    });

    await expect(execRuntimeCheck(workspace, ['--write'])).resolves.toBeDefined();
    await expect(readFile(join(workspace, 'mise.toml'), 'utf8')).resolves.toBe(
      `[tools]
node = "${manifest.node}"

[settings]
node.corepack = true
`,
    );
    await expect(readFile(join(workspace, '.husky/pre-commit'), 'utf8')).resolves.toBe(
      '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run lint:staged\n',
    );
    await expect(readFile(join(workspace, '.husky/pre-push'), 'utf8')).resolves.toBe(
      '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run check:pre-push\n',
    );
    const updatedPackage = JSON.parse(await readFile(packagePath, 'utf8'));
    expect(updatedPackage.scripts.setup).toBe(
      'node scripts/run-pnpm.mjs install --frozen-lockfile',
    );
    expect(updatedPackage.scripts['toolchain:check']).toBe('node scripts/check-toolchain.mjs');
    await expect(readFile(ciPath, 'utf8')).resolves.toContain('corepack pnpm run toolchain:check');
    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('accepts Windows-style CRLF line endings in governed toolchain files', async () => {
    const workspace = await createRuntimeWorkspace();
    for (const path of ['mise.toml', '.husky/pre-commit', '.husky/pre-push']) {
      const target = join(workspace, path);
      await writeFile(target, (await readFile(target, 'utf8')).replaceAll('\n', '\r\n'));
    }

    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('fails when the shared setup action bypasses Corepack parity checks', async () => {
    const workspace = await createRuntimeWorkspace();
    const actionPath = join(workspace, '.github/actions/setup-pnpm/action.yml');
    await writeFile(
      actionPath,
      (await readFile(actionPath, 'utf8'))
        .replace('direct_pnpm_version="$(pnpm --version)"\n', '')
        .replace(
          'run: corepack pnpm install --frozen-lockfile',
          'run: pnpm install --frozen-lockfile',
        ),
    );

    await expect(execRuntimeCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '.github/actions/setup-pnpm/action.yml: deterministic toolchain contract',
      ),
    });
  });

  it('fails when generated scaffold runtime values drift from the runtime manifest', async () => {
    const workspace = await createRuntimeWorkspace();
    await writeFixture(
      workspace,
      'packages/cli/src/generated/scaffold-template.ts',
      `export const scaffoldTemplateConfig = {
  runtime: {
    node: '24.15.0',
    nodeDockerAlpineDigest: '${manifest.nodeDockerAlpineDigest}',
    pnpm: '${manifest.pnpm}',
  },
} as const;
`,
    );

    await expect(execRuntimeCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('does not match tools/runtime-versions.json'),
    });
  });

  it('writes every governed pnpm mirror from the runtime manifest', async () => {
    const workspace = await createRuntimeWorkspace();
    await writeFixture(
      workspace,
      'package.json',
      `${JSON.stringify(
        {
          packageManager: 'pnpm@11.1.0',
          engines: { pnpm: '>=11.1.0 <12' },
          scripts: {
            setup: 'corepack prepare pnpm@11.1.0 --activate && pnpm install --frozen-lockfile',
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFixture(
      workspace,
      'apps/mission-control/package.json',
      `${JSON.stringify(
        {
          packageManager: 'pnpm@11.1.0',
          engines: { pnpm: '>=11.1.0 <12' },
        },
        null,
        2,
      )}\n`,
    );
    await writeFixture(
      workspace,
      'apps/demo/package.json',
      `${JSON.stringify({ engines: { pnpm: '>=11.1.0 <12' } }, null, 2)}\n`,
    );
    await writeFixture(workspace, 'apps/demo/Dockerfile', 'ARG PNPM_VERSION=11.1.0\n');
    await writeFixture(workspace, 'packages/registry/Dockerfile', 'ARG PNPM_VERSION=11.1.0\n');
    await writeFixture(
      workspace,
      'packages/cli/src/generated/scaffold-template.ts',
      `export const scaffoldTemplateConfig = {
  runtime: {
    node: '${manifest.node}',
    nodeDockerAlpineDigest: '${manifest.nodeDockerAlpineDigest}',
    pnpm: '11.1.0',
  },
} as const;
`,
    );
    await writeFixture(
      workspace,
      'README.md',
      '<img src="https://img.shields.io/badge/pnpm-11.1.0-F69220" alt="pnpm 11.1.0" />\n',
    );
    await writeFixture(workspace, 'CONTRIBUTING.md', 'Use pnpm `11.1.0` by default.\n');
    await writeFixture(workspace, 'docs/compatibility.md', 'pnpm `11.1.0` and `11.1.0`.\n');
    await writeFixture(
      workspace,
      'docs-site/guide/compatibility.md',
      'pnpm `11.1.0` and `11.1.0`.\n',
    );
    await writeFixture(workspace, 'docs/openssf-evidence.md', 'Package manager: `pnpm@11.1.0`\n');
    await writeFixture(workspace, 'docs/repo-maturity-report.md', 'pnpm 11.1.0 with lockfile.\n');

    await expect(execRuntimeCheck(workspace, ['--write'])).resolves.toBeDefined();

    const rootPackage = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
    const appPackage = JSON.parse(
      await readFile(join(workspace, 'apps/mission-control/package.json'), 'utf8'),
    );
    const demoPackage = JSON.parse(
      await readFile(join(workspace, 'apps/demo/package.json'), 'utf8'),
    );
    expect(rootPackage.packageManager).toBe(`pnpm@${manifest.pnpm}`);
    expect(rootPackage.engines.pnpm).toBe('>=11 <12');
    expect(rootPackage.scripts.setup).toBe('node scripts/run-pnpm.mjs install --frozen-lockfile');
    expect(rootPackage.scripts['toolchain:check']).toBe('node scripts/check-toolchain.mjs');
    expect(appPackage.packageManager).toBe(`pnpm@${manifest.pnpm}`);
    expect(appPackage.engines.pnpm).toBe('>=11 <12');
    expect(demoPackage.engines.pnpm).toBe('>=11 <12');
    await expect(readFile(join(workspace, 'apps/demo/Dockerfile'), 'utf8')).resolves.toContain(
      `ARG PNPM_VERSION=${manifest.pnpm}`,
    );
    await expect(
      readFile(join(workspace, 'packages/cli/src/generated/scaffold-template.ts'), 'utf8'),
    ).resolves.toContain(`pnpm: '${manifest.pnpm}'`);
    for (const path of [
      'README.md',
      'CONTRIBUTING.md',
      'docs/compatibility.md',
      'docs-site/guide/compatibility.md',
      'docs/openssf-evidence.md',
      'docs/repo-maturity-report.md',
    ]) {
      await expect(readFile(join(workspace, path), 'utf8')).resolves.not.toContain('11.1.0');
    }
    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('accepts compatibility include rows that start with an auxiliary key', async () => {
    const workspace = await createRuntimeWorkspace({
      compatibilityRowsYaml: `          - label: minimum
            node: '22.22.3'
            runner: ubuntu-latest
            os: ubuntu-latest
          - label: windows-primary
            runner: windows-2025-vs2026
            node: '24.16.0'
            os: windows-latest
          - label: macos-primary
            os: macos-latest
            node: '24.16.0'
            runner: macos-latest`,
    });

    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('stops compatibility parsing before matrix exclude rows', async () => {
    const workspace = await createRuntimeWorkspace({
      compatibilityRowsYaml: `          - os: ubuntu-latest
            runner: ubuntu-latest
            node: '22.22.3'
          - os: windows-latest
            runner: windows-2025-vs2026
            node: '24.16.0'
          - os: macos-latest
            runner: macos-latest
            node: '24.16.0'
        exclude:
          - os: ubuntu-latest
            node: '24.16.0'`,
    });

    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('stops compatibility parsing at commented next-job headers', async () => {
    const workspace = await createRuntimeWorkspace({
      ciWorkflowSuffix: `
  lint: # code quality
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            node: '24.16.0'
`,
    });

    await expect(execRuntimeCheck(workspace)).resolves.toBeDefined();
  });

  it('does not rewrite dependent contexts when matrix parsing fails in write mode', async () => {
    const workspace = await createRuntimeWorkspace({
      compatibilityRowsYaml: `          - os: ubuntu-latest
            node: '22.22.3'`,
    });
    const rulesetPath = join(workspace, '.github/rulesets/main.json');
    const docPath = join(workspace, 'docs/release/branch-protection.md');
    const rulesetBefore = await readFile(rulesetPath, 'utf8');
    const docBefore = await readFile(docPath, 'utf8');

    await expect(execRuntimeCheck(workspace, ['--write'])).rejects.toMatchObject({
      stderr: expect.stringContaining('compatibility matrix row missing runner'),
    });

    await expect(readFile(rulesetPath, 'utf8')).resolves.toBe(rulesetBefore);
    await expect(readFile(docPath, 'utf8')).resolves.toBe(docBefore);
  });

  it('ignores include-like run block text when reading the compatibility matrix', async () => {
    const workspace = await createRuntimeWorkspace({
      ciWorkflowOverride: `name: CI

env:
  NODE_VERSION: '${manifest.node}'

jobs:
  compatibility-smoke:
    name: CI / compatibility-smoke
    runs-on: ubuntu-latest
    steps:
      - run: |
          cat <<'YAML'
          strategy:
            matrix:
              include:
                - os: ubuntu-latest
                  runner: ubuntu-latest
                  node: '22.22.3'
                - os: windows-latest
                  runner: windows-2025-vs2026
                  node: '24.16.0'
                - os: macos-latest
                  runner: macos-latest
                  node: '24.16.0'
          YAML
`,
    });

    await expect(execRuntimeCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('compatibility matrix include rows not found'),
    });
  });
});

async function createRuntimeWorkspace(
  options: {
    branchProtectionContexts?: string[];
    ciWorkflowOverride?: string;
    ciWorkflowSuffix?: string;
    compatibilityRows?: Array<{ os: string; runner: string; node: string }>;
    compatibilityRowsYaml?: string;
    rulesetRequiredStatusChecks?: unknown;
    rulesetContexts?: Array<string | RulesetEntry>;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2a-runtime-versions-'));
  tempRoots.push(root);

  const compatibilityRows = options.compatibilityRows ?? [
    { os: 'ubuntu-latest', runner: 'ubuntu-latest', node: '22.22.3' },
    { os: 'windows-latest', runner: 'windows-2025-vs2026', node: '24.16.0' },
    { os: 'macos-latest', runner: 'macos-latest', node: '24.16.0' },
  ];
  const defaultCompatibilityContexts = [
    'CI / compatibility-smoke (ubuntu-latest, node 22.22.3)',
    'CI / compatibility-smoke (windows-latest, node 24.16.0)',
    'CI / compatibility-smoke (macos-latest, node 24.16.0)',
  ];
  const rulesetContexts = options.rulesetContexts ?? defaultCompatibilityContexts;
  const branchProtectionContexts = options.branchProtectionContexts ?? defaultCompatibilityContexts;

  await writeFixture(root, 'tools/runtime-versions.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFixture(root, '.node-version', `${manifest.node}\n`);
  await writeFixture(root, '.nvmrc', `${manifest.node}\n`);
  await writeFixture(
    root,
    'mise.toml',
    `[tools]\nnode = "${manifest.node}"\n\n[settings]\nnode.corepack = true\n`,
  );
  await writeFixture(
    root,
    '.husky/pre-commit',
    '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run lint:staged\n',
  );
  await writeFixture(
    root,
    '.husky/pre-push',
    '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run check:pre-push\n',
  );
  await writeFixture(
    root,
    'package.json',
    `${JSON.stringify(
      {
        packageManager: `pnpm@${manifest.pnpm}`,
        engines: { pnpm: '>=11 <12' },
        scripts: {
          setup: 'node scripts/run-pnpm.mjs install --frozen-lockfile',
          'toolchain:check': 'node scripts/check-toolchain.mjs',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    root,
    'apps/demo/package.json',
    `${JSON.stringify({ engines: { pnpm: '>=11 <12' } }, null, 2)}\n`,
  );
  for (const path of [
    'apps/mission-control/package.json',
    'apps/registry-ui/package.json',
    'docs-site/package.json',
  ]) {
    await writeFixture(
      root,
      path,
      `${JSON.stringify(
        {
          packageManager: `pnpm@${manifest.pnpm}`,
          engines: { pnpm: '>=11 <12' },
        },
        null,
        2,
      )}\n`,
    );
  }
  await writeFixture(root, 'apps/demo/Dockerfile', `ARG PNPM_VERSION=${manifest.pnpm}\n`);
  await writeFixture(root, 'packages/registry/Dockerfile', `ARG PNPM_VERSION=${manifest.pnpm}\n`);
  await writeFixture(
    root,
    'README.md',
    `<img src="https://img.shields.io/badge/pnpm-${manifest.pnpm}-F69220" alt="pnpm ${manifest.pnpm}" />\n`,
  );
  await writeFixture(root, 'CONTRIBUTING.md', `Use pnpm \`${manifest.pnpm}\` by default.\n`);
  await writeFixture(
    root,
    'docs/compatibility.md',
    `pnpm \`${manifest.pnpm}\` and \`${manifest.pnpm}\`.\n`,
  );
  await writeFixture(
    root,
    'docs-site/guide/compatibility.md',
    `pnpm \`${manifest.pnpm}\` and \`${manifest.pnpm}\`.\n`,
  );
  await writeFixture(
    root,
    'docs/openssf-evidence.md',
    `Package manager: \`pnpm@${manifest.pnpm}\`\n`,
  );
  await writeFixture(
    root,
    'docs/repo-maturity-report.md',
    `pnpm ${manifest.pnpm} with lockfile.\n`,
  );

  await writeFixture(
    root,
    'packages/cli/src/generated/scaffold-template.ts',
    `export const scaffoldTemplateConfig = {
  runtime: {
    node: '${manifest.node}',
    nodeDockerAlpineDigest: '${manifest.nodeDockerAlpineDigest}',
    pnpm: '${manifest.pnpm}',
  },
} as const;
`,
  );
  await writeFixture(
    root,
    '.github/workflows/ci.yml',
    options.ciWorkflowOverride ??
      ciWorkflow(compatibilityRows, options.compatibilityRowsYaml, options.ciWorkflowSuffix),
  );
  for (const workflow of ['docs.yml', 'release-please.yml', 'security.yml']) {
    await writeFixture(root, `.github/workflows/${workflow}`, workflowWithNodeEnv());
  }
  await writeFixture(root, '.github/workflows/publish.yml', publishWorkflow());
  await writeFixture(root, '.github/actions/setup-pnpm/action.yml', setupPnpmAction());
  await writeFixture(
    root,
    '.github/rulesets/main.json',
    ruleset(rulesetContexts, options.rulesetRequiredStatusChecks),
  );
  await writeFixture(
    root,
    'docs/release/branch-protection.md',
    branchProtectionDoc(branchProtectionContexts),
  );

  return root;
}

async function execRuntimeCheck(cwd: string, args: string[] = []) {
  return execFileAsync('node', [scriptPath, ...args], { cwd });
}

async function writeFixture(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

function ciWorkflow(
  rows: Array<{ os: string; runner: string; node: string }>,
  matrixRowsOverride?: string,
  suffix = '',
): string {
  const matrixRows =
    matrixRowsOverride ??
    rows
      .map(
        (row) => `          - os: ${row.os}
            runner: ${row.runner}
            node: '${row.node}'`,
      )
      .join('\n');

  return `name: CI

env:
  NODE_VERSION: '${manifest.node}'

jobs:
  compatibility-smoke:
    name: CI / compatibility-smoke (\${{ matrix.os }}, node \${{ matrix.node }})
    runs-on: \${{ matrix.runner }}
    strategy:
      matrix:
        include:
${matrixRows}
    steps:
      - run: corepack pnpm run toolchain:check
      - run: pnpm run lint:identity
${suffix}
`;
}

function workflowWithNodeEnv(): string {
  return `name: fixture

env:
  NODE_VERSION: '${manifest.node}'
`;
}

function setupPnpmAction(): string {
  return `name: Setup pnpm
runs:
  using: composite
  steps:
    - name: Resolve pnpm store
      shell: bash
      run: |
        corepack_pnpm_version="$(corepack pnpm --version)"
        direct_pnpm_version="$(pnpm --version)"
        if [[ "\${direct_pnpm_version}" != "\${corepack_pnpm_version}" ]]; then
          exit 1
        fi
        store_path="$(corepack pnpm store path --silent)"
    - name: Install dependencies
      shell: bash
      run: corepack pnpm install --frozen-lockfile
`;
}

function publishWorkflow(): string {
  return `name: publish

env:
  NODE_VERSION: '${manifest.node}'
  NPM_VERSION: '${manifest.npmForPublish}'
`;
}

function ruleset(contexts: Array<string | RulesetEntry>, requiredStatusChecks?: unknown): string {
  return `${JSON.stringify(
    {
      name: 'main-protection',
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks:
              requiredStatusChecks ??
              contexts.map((entry) => (typeof entry === 'string' ? { context: entry } : entry)),
          },
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function branchProtectionDoc(contexts: string[]): string {
  return `# Branch Protection

${contexts.map((context) => `- \`${context}\``).join('\n')}
`;
}
