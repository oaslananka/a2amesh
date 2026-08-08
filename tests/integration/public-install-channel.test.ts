import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type PublicInstallValidator = (
  documents: Record<string, string>,
  activeVersion?: string,
) => string[];

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
    expect(checkerSource).toContain("'docs-site/public/screenshots/quick-demo-flow.svg'");
  });

  it('keeps checked-in public install surfaces on the active prerelease channel', async () => {
    const moduleUrl = new URL('../../scripts/check-docs-commands.mjs', import.meta.url);
    const checker = (await import(moduleUrl.href)) as Record<string, unknown>;
    const validate = checker['validatePublicInstallPolicy'] as PublicInstallValidator;
    const paths = [
      'README.md',
      'docs/install.md',
      'docs/quickstart.md',
      'docs/faq.md',
      'docs/distribution.md',
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

    expect(validate(documents, '0.18.0-alpha.1')).toEqual([]);

    const packageReadmes = {
      runtime: documents['packages/runtime/README.md'],
      protocol: documents['packages/protocol/README.md'],
      registry: documents['packages/registry/README.md'],
      cli: documents['packages/cli/README.md'],
      mcp: documents['packages/mcp/README.md'],
      'create-a2amesh': documents['packages/create-a2amesh/README.md'],
    };
    for (const [packageName, readme] of Object.entries(packageReadmes)) {
      expect(readme).toContain(`@a2amesh/${packageName}@alpha`);
    }
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
