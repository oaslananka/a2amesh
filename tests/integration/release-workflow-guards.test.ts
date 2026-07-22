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
      'node "${RUNNER_TEMP}/release-state-guard/release-state.mjs" --mode publish --json --tag "${TAG}" --recovery-file "${RUNNER_TEMP}/release-state-guard/.release-recovery.json"',
    );
    expect(workflow).not.toContain('node scripts/release-state.mjs --check');
  });

  it('statically enforces both workflow gates in release config validation', async () => {
    const checker = await readFile(new URL('scripts/check-release-config.mjs', repoRoot), 'utf8');

    expect(checker).toContain('--mode release-please --json');
    expect(checker).toContain('--mode publish --json --tag');
    expect(checker).toContain("github.ref == 'refs/heads/main'");
    expect(checker).toContain('Stage release-state guard scripts');
    expect(checker).toContain('ref: ${{ steps.tag.outputs.tag }}');
    expect(checker).toContain('.release-recovery.json');
    expect(checker).toContain('--recovery-file');
    expect(checker).toContain('sync-security-policy.mjs');
    expect(checker).toContain('SECURITY.md .github/SECURITY.md');
  });
});
