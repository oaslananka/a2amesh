import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

describe('release workflow guards', () => {
  it('gates Release Please before creating or updating a release PR', async () => {
    const workflow = await readFile(
      new URL('.github/workflows/release-please.yml', repoRoot),
      'utf8',
    );
    const gateIndex = workflow.indexOf(
      'node scripts/release-state.mjs --mode release-please --json',
    );
    const componentTagsIndex = workflow.indexOf('name: Verify published component tags');
    const actionIndex = workflow.indexOf('googleapis/release-please-action');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(componentTagsIndex).toBeGreaterThan(gateIndex);
    expect(componentTagsIndex).toBeLessThan(actionIndex);
    expect(workflow).toContain('--verify-only');
    expect(workflow).toContain('include-component-in-tag: true');
    expect(workflow).toContain('node scripts/sync-security-policy.mjs');
    expect(workflow).toContain(
      'node scripts/sync-release-pr-policy.mjs --clear-release-as --sync-install-docs',
    );
    expect(workflow).toContain('git status --porcelain');
    expect(workflow).toContain('git ls-files --others --exclude-standard');
    expect(workflow).toContain('git diff --check');
    expect(workflow).toContain('git add -u');
    expect(workflow).toContain('git diff --cached --check');
  });

  it('checks out the requested tag and runs publish-mode validation', async () => {
    const workflow = await readFile(new URL('.github/workflows/publish.yml', repoRoot), 'utf8');

    expect(workflow).toContain(
      "if: github.repository == 'oaslananka/a2amesh' && github.ref == 'refs/heads/main'",
    );
    expect(workflow).toContain('Stage release-state guard scripts');
    expect(workflow).toContain(
      'cp scripts/release-state.mjs scripts/release-state-core.mjs .release-recovery.json "${RUNNER_TEMP}/release-state-guard/"',
    );
    expect(workflow).toContain('ref: ${{ steps.tag.outputs.tag }}');
    expect(workflow).toContain(
      'node "${RUNNER_TEMP}/release-state-guard/release-state.mjs" --mode "${MODE}" --json --tag "${TAG}" --recovery-file "${RUNNER_TEMP}/release-state-guard/.release-recovery.json"',
    );
    expect(workflow).not.toContain('node scripts/release-state.mjs --check');
  });

  it('requires a distinct confirmation before a stable publish can advance latest', async () => {
    const workflow = await readFile(new URL('.github/workflows/publish.yml', repoRoot), 'utf8');
    const checker = await readFile(new URL('scripts/check-release-config.mjs', repoRoot), 'utf8');

    for (const source of [workflow, checker]) {
      expect(source).toContain('PUBLISH STABLE ${TAG}');
      expect(source).toContain('STABLE_RELEASE_TAG_PATTERN');
    }
    expect(workflow).toContain('Prerelease: PUBLISH <tag>; stable: PUBLISH STABLE <tag>');
    expect(workflow).toContain('if [[ "${TAG}" =~ ${STABLE_RELEASE_TAG_PATTERN} ]]');
  });

  it('requires an explicit asset-retention operation and skips npm publication', async () => {
    const workflow = await readFile(new URL('.github/workflows/publish.yml', repoRoot), 'utf8');

    expect(workflow).toContain('operation:');
    expect(workflow).toContain('- retain-assets');
    expect(workflow).toContain('RETAIN ${TAG}');
    expect(workflow).toContain('--mode "${MODE}"');
    expect(workflow).toContain("if: steps.tag.outputs.operation == 'publish'");
  });

  it('uploads verified release assets only after npm registry parity passes', async () => {
    const workflow = await readFile(new URL('.github/workflows/publish.yml', repoRoot), 'utf8');
    const parityIndex = workflow.indexOf('name: Verify package registry parity');
    const uploadIndex = workflow.indexOf('name: Upload verified release assets');

    expect(workflow).toMatch(/publish:\n(?:.|\n)*?permissions:\n(?:.|\n)*?contents: write/);
    expect(parityIndex).toBeGreaterThan(-1);
    const componentTagsIndex = workflow.indexOf('name: Synchronize Release Please component tags');

    expect(componentTagsIndex).toBeGreaterThan(parityIndex);
    expect(uploadIndex).toBeGreaterThan(componentTagsIndex);
    expect(workflow).toContain('sync-release-component-tags.mjs');
    expect(workflow).toContain('gh release upload "${TAG}"');
    expect(workflow).toContain('.artifacts/npm/*.tgz');
    expect(workflow).toContain('.artifacts/npm/SHA256SUMS');
    expect(workflow).toContain('.artifacts/sbom/a2amesh.cdx.json');
    expect(workflow).toContain('--repo "${GITHUB_REPOSITORY}"');
    expect(workflow).toContain('--clobber');
  });

  it('statically enforces both workflow gates in release config validation', async () => {
    const checker = await readFile(new URL('scripts/check-release-config.mjs', repoRoot), 'utf8');

    expect(checker).toContain('--mode release-please --json');
    expect(checker).toContain('--mode "${MODE}" --json --tag');
    expect(checker).toContain('- retain-assets');
    expect(checker).toContain('RETAIN ${TAG}');
    expect(checker).toContain("github.ref == 'refs/heads/main'");
    expect(checker).toContain('Stage release-state guard scripts');
    expect(checker).toContain('ref: ${{ steps.tag.outputs.tag }}');
    expect(checker).toContain('.release-recovery.json');
    expect(checker).toContain('--recovery-file');
    expect(checker).toContain('sync-security-policy.mjs');
    expect(checker).toContain('sync-release-pr-policy.mjs');
    expect(checker).toContain('--sync-install-docs');
    expect(checker).toContain('git status --porcelain');
    expect(checker).toContain('git ls-files --others --exclude-standard');
    expect(checker).toContain('git add -u');
    expect(checker).toContain('git diff --cached --check');
    expect(checker).toContain('sync-release-component-tags.mjs');
    expect(checker).toContain('Synchronize Release Please component tags');
    expect(checker).toContain('Verify published component tags');
    expect(checker).toContain('--verify-only');
    expect(checker).toContain('include-component-in-tag: true');
  });

  it('keeps the repository-root deployment chart coupled to the linked runtime release', async () => {
    const [configText, manifestText, chart] = await Promise.all([
      readFile(new URL('release-please-config.json', repoRoot), 'utf8'),
      readFile(new URL('.release-please-manifest.json', repoRoot), 'utf8'),
      readFile(new URL('deploy/helm/a2amesh/Chart.yaml', repoRoot), 'utf8'),
    ]);
    const config = JSON.parse(configText) as {
      packages: Record<string, { 'extra-files'?: Array<{ type: string; path: string }> }>;
    };
    const manifest = JSON.parse(manifestText) as Record<string, string>;
    const runtimeVersion = manifest['packages/runtime'];

    expect(config.packages['packages/runtime']?.['extra-files']).toEqual(
      expect.arrayContaining([
        {
          type: 'generic',
          path: '/deploy/helm/a2amesh/Chart.yaml',
        },
      ]),
    );
    expect(chart).toContain(`version: ${runtimeVersion} # x-release-please-version`);
    expect(chart).toContain(`appVersion: ${runtimeVersion} # x-release-please-version`);
  });
});
