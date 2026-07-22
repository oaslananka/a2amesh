import { describe, expect, it } from 'vitest';
import {
  validateToolchainDiagnostics,
  type ToolchainDiagnostics,
  type ToolchainManifest,
} from '../../scripts/check-toolchain.mjs';

const manifest: ToolchainManifest = {
  node: '24.16.0',
  nodeCompatibility: ['22.22.3', '24.16.0'],
  pnpm: '11.8.0',
};

function diagnostics(overrides: Partial<ToolchainDiagnostics> = {}): ToolchainDiagnostics {
  return {
    node: { version: '24.16.0', executable: '/opt/node/bin/node' },
    packageManager: 'pnpm@11.8.0',
    directPnpm: {
      version: '11.8.0',
      executable: '/opt/node/bin/pnpm',
    },
    corepackPnpm: {
      version: '11.8.0',
      executable: '/opt/node/bin/corepack',
    },
    childPnpm: {
      version: '11.8.0',
      executable: '/opt/node/bin/pnpm',
    },
    ...overrides,
  };
}

describe('toolchain diagnostics', () => {
  it('accepts matching direct, Corepack, and child-process pnpm resolution', () => {
    expect(validateToolchainDiagnostics(manifest, diagnostics())).toEqual([]);
  });

  it('accepts every explicitly supported Node compatibility version', () => {
    expect(
      validateToolchainDiagnostics(
        manifest,
        diagnostics({ node: { version: '22.22.3', executable: '/opt/node/bin/node' } }),
      ),
    ).toEqual([]);
  });

  it('reports metadata, version, command, and executable drift with remediation context', () => {
    const failures = validateToolchainDiagnostics(
      manifest,
      diagnostics({
        node: { version: '23.1.0', executable: '/opt/node/bin/node' },
        packageManager: 'pnpm@11.7.0',
        directPnpm: {
          version: null,
          executable: '/home/user/.local/share/mise/shims/pnpm',
          error: 'mise: no version is set for shim: pnpm',
        },
        corepackPnpm: {
          version: '11.7.0',
          executable: '/opt/node/bin/corepack',
        },
        childPnpm: {
          version: '11.8.0',
          executable: '/different/bin/pnpm',
        },
      }),
    );

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Node.js 23.1.0 is not in the supported compatibility set'),
        expect.stringContaining('packageManager must be pnpm@11.8.0'),
        expect.stringContaining('direct pnpm failed'),
        expect.stringContaining('Corepack pnpm resolved 11.7.0 instead of 11.8.0'),
        expect.stringContaining('child-process pnpm executable'),
      ]),
    );
  });
});
