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
    const actionIndex = workflow.indexOf('googleapis/release-please-action');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(actionIndex);
    expect(workflow).toContain('node scripts/sync-security-policy.mjs');
    expect(workflow).toContain('SECURITY.md .github/SECURITY.md');
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
    expect(uploadIndex).toBeGreaterThan(parityIndex);
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
    expect(checker).toContain('SECURITY.md .github/SECURITY.md');
  });
});
