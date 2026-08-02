import { describe, expect, it } from 'vitest';
import {
  releaseChannelForVersion,
  validatePublicSurfacePolicy,
} from '../../scripts/public-surface-policy.mjs';

const basePackage = {
  name: '@a2amesh/cli',
  version: '0.17.0-alpha.1',
  exports: { '.': { import: './dist/index.js' } },
  bin: { a2amesh: 'bin/a2amesh.js' },
};

describe('public surface policy', () => {
  it('derives stable and prerelease channels from SemVer versions', () => {
    expect(releaseChannelForVersion('1.0.0')).toBe('stable');
    expect(releaseChannelForVersion('1.0.0-alpha.2')).toBe('alpha');
    expect(releaseChannelForVersion('1.0.0-beta.1')).toBe('beta');
    expect(releaseChannelForVersion('1.0.0-rc.3')).toBe('rc');
  });

  it('accepts an alpha package when exports and bins match its inventory', () => {
    expect(
      validatePublicSurfacePolicy({
        packagePath: 'packages/cli/package.json',
        inventoryPath: 'packages/cli/public-surface.json',
        packageJson: basePackage,
        inventory: { status: 'alpha', exports: ['.'], bins: ['a2amesh'] },
      }),
    ).toEqual([]);
  });

  it('reports binary drift and blocks prerelease surfaces for a stable target', () => {
    const drift = validatePublicSurfacePolicy({
      packagePath: 'packages/cli/package.json',
      inventoryPath: 'packages/cli/public-surface.json',
      packageJson: basePackage,
      inventory: { status: 'alpha', exports: ['.'], bins: ['different-bin'] },
      target: 'stable',
    });

    expect(drift).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bins'),
        expect.stringContaining('stable release target'),
      ]),
    );
  });
});
