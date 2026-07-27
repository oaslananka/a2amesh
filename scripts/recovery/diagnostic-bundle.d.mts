// SPDX-FileCopyrightText: 2026 oaslananka
// SPDX-License-Identifier: Apache-2.0

export function createDiagnosticBundle(options: {
  manifestPath: string;
  sourceDirectory: string;
  outputDirectory: string;
  now?: () => Date;
}): Promise<{
  files: string[];
  index: {
    schemaVersion: 1;
    createdAt: string;
    classification: string;
    files: Array<{ name: string; sizeBytes: number; sha256: string }>;
  };
}>;
export function validateDiagnosticBundle(options: {
  manifestPath: string;
  bundleDirectory: string;
}): Promise<{ valid: true; files: string[] }>;
