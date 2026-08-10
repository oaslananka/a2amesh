import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type PublicInstallValidator = (
  documents: Record<string, string>,
  activeVersion?: string,
) => string[];
type PublicInstallRewriter = (text: string, activeVersion: string, documentPath?: string) => string;

describe('public prerelease install channel policy', () => {
  it('exposes a reusable validator from the docs command checker', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;

    expect(checker['validatePublicInstallPolicy']).toBeTypeOf('function');
  });

  it('wires the install-channel validator into the repository docs check', async () => {
    const checkerSource = await readFile(
      new URL('../../scripts/check-docs-commands.mjs', import.meta.url),
      'utf8',
    );

    expect(checkerSource).toContain("readJson('.release-please-manifest.json')");
    expect(checkerSource).toContain(
      'validatePublicInstallPolicy(publicInstallDocuments, activeVersion)',
    );
    expect(checkerSource).toContain("'docs-site/guide/quick-start.md'");
    expect(checkerSource).toContain("'docs/agent-plugin.md'");
    expect(checkerSource).toContain("'.mcp.json'");
    expect(checkerSource).toContain("'skills/a2a-endpoint-validation/SKILL.md'");
    expect(checkerSource).toContain("'examples/openclaw-mcp/README.md'");
    expect(checkerSource).toContain("'docs/migrating/security-upgrades.md'");
    expect(checkerSource).toContain("'docs-site/security/security-upgrades.md'");
    expect(checkerSource).toContain("'docs-site/public/screenshots/quick-demo-flow.svg'");
  });

  it('keeps checked-in public install surfaces aligned with the active release channel', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;
    const paths = [
      'README.md',
      'docs/install.md',
      'docs/quickstart.md',
      'docs/faq.md',
      'docs/distribution.md',
      'docs/agent-plugin.md',
      '.mcp.json',
      '.codex/config.example.toml',
      '.vscode/mcp.example.json',
      'opencode.example.jsonc',
      'skills/a2a-endpoint-validation/SKILL.md',
      'skills/a2a-task-operations/SKILL.md',
      '.opencode/skills/a2a-endpoint-validation/SKILL.md',
      '.opencode/skills/a2a-task-operations/SKILL.md',
      'examples/openclaw-mcp/README.md',
      'docs/migrating/security-upgrades.md',
      'docs/packages/runtime.md',
      'docs/packages/protocol.md',
      'docs/packages/registry.md',
      'docs/packages/cli.md',
      'docs/packages/mcp.md',
      'docs/packages/create-a2amesh.md',
      'packages/runtime/README.md',
      'packages/protocol/README.md',
      'packages/registry/README.md',
      'packages/cli/README.md',
      'packages/mcp/README.md',
      'packages/create-a2amesh/README.md',
      'docs-site/guide/installation.md',
      'docs-site/guide/quick-start.md',
      'docs-site/guide/demo.md',
      'docs-site/packages/runtime.md',
      'docs-site/packages/protocol.md',
      'docs-site/packages/registry.md',
      'docs-site/packages/cli.md',
      'docs-site/packages/mcp.md',
      'docs-site/packages/create-a2amesh.md',
      'docs-site/security/security-upgrades.md',
      'docs-site/public/screenshots/quick-demo-flow.svg',
    ];
    const documents = Object.fromEntries(
      await Promise.all(
        paths.map(async (path) => [
          path,
          await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'),
        ]),
      ),
    );

    const manifest = JSON.parse(
      await readFile(new URL('../../.release-please-manifest.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    expect(validate(documents, manifest['packages/runtime'])).toEqual([]);
  });

  it('rewrites install selectors for stable and prerelease channels', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const rewrite = checker['rewritePublicInstallPolicy'] as PublicInstallRewriter;
    const source = [
      'pnpm add @a2amesh/runtime@alpha',
      'pnpm add --global @a2amesh/cli@alpha',
      'pnpm dlx @a2amesh/create-a2amesh@alpha demo',
      'Narrative @a2amesh/runtime@alpha remains untouched.',
    ].join('\n');

    expect(rewrite(source, '0.18.1')).toBe(
      [
        'pnpm add @a2amesh/runtime',
        'pnpm add --global @a2amesh/cli',
        'pnpm dlx @a2amesh/create-a2amesh demo',
        'Narrative @a2amesh/runtime@alpha remains untouched.',
      ].join('\n'),
    );
    expect(rewrite(source, '0.19.0-beta.1')).toBe(
      [
        'pnpm add @a2amesh/runtime@beta',
        'pnpm add --global @a2amesh/cli@beta',
        'pnpm dlx @a2amesh/create-a2amesh@beta demo',
        'Narrative @a2amesh/runtime@alpha remains untouched.',
      ].join('\n'),
    );
    const configLine = '  "args": ["-y", "-p", "@a2amesh/mcp@alpha", "a2amesh-mcp"]';
    expect(rewrite(configLine, '0.18.1', '.mcp.json')).toContain('"@a2amesh/mcp"');
    expect(rewrite(configLine, '0.19.0-beta.1', '.mcp.json')).toContain('"@a2amesh/mcp@beta"');
    expect(rewrite(configLine, '0.18.1')).toBe(configLine);
  });

  it('validates and rewrites OpenClaw multiline install arguments', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;
    const rewrite = checker['rewritePublicInstallPolicy'] as PublicInstallRewriter;
    const source = [
      'openclaw mcp add a2amesh \\',
      '  --command npx \\',
      '  --arg -y \\',
      '  --arg -p \\',
      '  --arg @a2amesh/mcp@alpha \\',
      '  --arg a2amesh-mcp',
    ].join('\n');

    expect(validate({ 'examples/openclaw-mcp/README.md': source }, '0.18.1')).toEqual([
      'examples/openclaw-mcp/README.md: stable public command must resolve latest or exact active version: --arg @a2amesh/mcp@alpha',
    ]);
    expect(rewrite(source, '0.18.1')).toContain('--arg @a2amesh/mcp \\');
    expect(rewrite(source, '0.19.0-beta.1')).toContain('--arg @a2amesh/mcp@beta \\');
  });

  it('validates and rewrites multiline install command continuations', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;
    const rewrite = checker['rewritePublicInstallPolicy'] as PublicInstallRewriter;
    const source = ['pnpm add \\', '  @a2amesh/protocol@alpha \\', '  @a2amesh/runtime@alpha'].join(
      '\n',
    );

    expect(validate({ 'docs/security-upgrades.md': source }, '0.18.1')).toEqual([
      'docs/security-upgrades.md: stable public command must resolve latest or exact active version: @a2amesh/protocol@alpha',
      'docs/security-upgrades.md: stable public command must resolve latest or exact active version: @a2amesh/runtime@alpha',
    ]);
    expect(rewrite(source, '0.18.1')).toBe(
      ['pnpm add \\', '  @a2amesh/protocol \\', '  @a2amesh/runtime'].join('\n'),
    );
    expect(rewrite(source, '0.19.0-beta.1')).toBe(
      ['pnpm add \\', '  @a2amesh/protocol@beta \\', '  @a2amesh/runtime@beta'].join('\n'),
    );
  });

  it('requires stable docs to resolve latest or the exact active stable version', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;

    expect(validate({ 'README.md': 'pnpm add @a2amesh/runtime@alpha' }, '1.0.0')).toEqual([
      'README.md: stable public command must resolve latest or exact active version: pnpm add @a2amesh/runtime@alpha',
    ]);
    expect(
      validate(
        {
          'README.md': [
            'pnpm add @a2amesh/runtime',
            'npm install @a2amesh/runtime@latest',
            'yarn add @a2amesh/runtime@1.0.0',
          ].join('\n'),
        },
        '1.0.0',
      ),
    ).toEqual([]);
  });

  it('rejects stale prerelease-channel prose for stable releases', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;
    const stale = [
      'A2A Mesh is currently published on the `alpha` npm dist-tag.',
      'The supported prerelease channel is `alpha`.',
      'An installed alpha CLI can also run `a2amesh init`.',
    ].join('\n');

    expect(validate({ 'README.md': stale }, '0.18.1')).toEqual([
      'README.md: stable public docs contain stale prerelease-channel guidance: A2A Mesh is currently published on the `alpha` npm dist-tag.',
      'README.md: stable public docs contain stale prerelease-channel guidance: The supported prerelease channel is `alpha`.',
      'README.md: stable public docs contain stale prerelease-channel guidance: An installed alpha CLI can also run `a2amesh init`.',
    ]);
    expect(validate({ 'README.md': stale }, '0.19.0-alpha.1')).toEqual([]);
  });

  it('rejects unqualified prerelease package and scaffolder commands', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;

    const failures = validate({
      'README.md': [
        'pnpm add @a2amesh/runtime',
        'pnpm add --global @a2amesh/cli',
        'pnpm dlx @a2amesh/create-a2amesh demo',
        'npm create a2amesh',
        'yarn create a2amesh',
        'yarn dlx @a2amesh/create-a2amesh demo',
      ].join('\n'),
    });

    expect(failures).toEqual([
      'README.md: public prerelease command must select @alpha or an exact version: pnpm add @a2amesh/runtime',
      'README.md: public prerelease command must select @alpha or an exact version: pnpm add --global @a2amesh/cli',
      'README.md: public prerelease command must select @alpha or an exact version: pnpm dlx @a2amesh/create-a2amesh demo',
      'README.md: unscoped create shorthand cannot select the supported @a2amesh alpha package: npm create a2amesh',
      'README.md: unscoped create shorthand cannot select the supported @a2amesh alpha package: yarn create a2amesh',
      'README.md: public prerelease command must select @alpha or an exact version: yarn dlx @a2amesh/create-a2amesh demo',
    ]);
  });
});
