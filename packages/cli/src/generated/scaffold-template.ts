// This file is written by scripts/build-tsc-package.mjs from workspace manifests and tools/runtime-versions.json.
export const scaffoldTemplateConfig = {
  dependencies: {
    '@a2amesh/protocol': '^0.7.0-alpha.1',
    '@a2amesh/runtime': '^0.7.0-alpha.1',
  },
  devDependencies: {
    '@types/node': '22.19.21',
    tsx: '4.22.4',
    typescript: '6.0.3',
  },
  runtime: {
    node: '24.16.0',
    nodeDockerAlpineDigest:
      'sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14',
    pnpm: '11.7.0',
  },
} as const;
