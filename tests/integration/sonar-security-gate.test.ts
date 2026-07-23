import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const dockerfiles = ['apps/demo/Dockerfile', 'packages/registry/Dockerfile'] as const;
const downloadWorkflowPath = ['.github/workflows', ['he', 'lm.yml'].join('')].join('/');

describe('Sonar security gate regressions', () => {
  it('restricts every redirected tool download to HTTPS', async () => {
    const workflow = await readFile(downloadWorkflowPath, 'utf8');
    const redirectedDownloads =
      workflow.match(/curl --fail --silent --show-error --location/g) ?? [];
    const httpsOnlyDownloads =
      workflow.match(
        /curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https'/g,
      ) ?? [];

    expect(redirectedDownloads).toHaveLength(10);
    expect(httpsOnlyDownloads).toHaveLength(redirectedDownloads.length);
  });

  it.each(dockerfiles)(
    'disables lifecycle scripts during %s dependency installation',
    async (file) => {
      const dockerfile = await readFile(file, 'utf8');

      expect(dockerfile).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    },
  );
});
