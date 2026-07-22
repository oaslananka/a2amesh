import path from 'node:path';
import { defineConfig } from 'vitest/config';
import {
  coverageExcludePatterns,
  coverageGlobalThresholds,
  coverageIncludePatterns,
} from './scripts/coverage-policy.mjs';

export default defineConfig({
  resolve: {
    alias: {
      '@a2amesh/protocol': path.resolve(__dirname, 'packages/protocol/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
    },
    setupFiles: ['./tests/setup/logging.ts'],
    pool: 'forks',
    maxWorkers: 4,
    testTimeout: 15000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary', 'html'],
      include: coverageIncludePatterns,
      exclude: coverageExcludePatterns,
      thresholds: coverageGlobalThresholds,
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/tests/**/*.test.ts', 'packages/cli/tests/**/*.test.ts'],
          exclude: ['tests/integration/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 15000,
        },
      },
      {
        extends: true,
        test: {
          name: 'transport-contract',
          include: ['tests/transport-contract/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 15000,
        },
      },
      {
        extends: true,
        test: {
          name: 'conformance',
          include: ['tests/conformance/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 15000,
        },
      },
    ],
  },
});
