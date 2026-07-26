import { describe, expect, it } from 'vitest';
import {
  validateLiveInteropManifest,
  type LiveInteropManifest,
} from '../../scripts/live-interop/manifest.mjs';

const validManifest: LiveInteropManifest = {
  schemaVersion: '2026-07-23',
  protocolVersion: '1.0',
  nodeVersion: '24.16.0',
  pythonVersion: '3.13.14',
  javascript: {
    package: '@a2a-js/sdk',
    version: '1.0.0',
  },
  python: {
    package: 'a2a-sdk',
    version: '1.1.2',
  },
};

describe('live interop manifest', () => {
  it('accepts the reviewed exact version contract', () => {
    expect(validateLiveInteropManifest(validManifest)).toEqual([]);
  });

  it.each(['latest', 'next', '^1.0.0', '~1.0.0', '>=1.0.0'])(
    'rejects mutable JavaScript SDK version %s',
    (version) => {
      expect(
        validateLiveInteropManifest({
          ...validManifest,
          javascript: { ...validManifest.javascript, version },
        }),
      ).toContain('javascript.version must be an exact semantic version');
    },
  );

  it.each([
    ['nodeVersion', '24'],
    ['nodeVersion', '24.16'],
    ['nodeVersion', 'latest'],
    ['pythonVersion', '3'],
    ['pythonVersion', '3.13'],
    ['pythonVersion', 'latest'],
  ] as const)('rejects mutable or incomplete runtime version %s=%s', (key, version) => {
    expect(validateLiveInteropManifest({ ...validManifest, [key]: version })).toContain(
      `${key} must be an exact three-part version`,
    );
  });

  it('rejects unsupported protocol and missing runtime versions', () => {
    expect(
      validateLiveInteropManifest({
        ...validManifest,
        protocolVersion: '1.2',
        nodeVersion: '',
        pythonVersion: '',
      }),
    ).toEqual(
      expect.arrayContaining([
        'protocolVersion must equal 1.0',
        'nodeVersion must be a non-empty string',
        'pythonVersion must be a non-empty string',
      ]),
    );
  });

  it('rejects package identity drift', () => {
    expect(
      validateLiveInteropManifest({
        ...validManifest,
        javascript: { package: '@example/sdk', version: '1.0.0' },
        python: { package: 'example-sdk', version: '1.1.2' },
      }),
    ).toEqual(
      expect.arrayContaining([
        'javascript.package must equal @a2a-js/sdk',
        'python.package must equal a2a-sdk',
      ]),
    );
  });
});
