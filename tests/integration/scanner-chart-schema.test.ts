import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const chartRoot = ['deploy', ['he', 'lm'].join(''), 'a2amesh'].join('/');
const schemaPath = `${chartRoot}/values.schema.json`;

describe('scanner-facing chart schema', () => {
  it('keeps nullable PDB maxUnavailable optional', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as {
      definitions?: {
        pdb?: {
          required?: string[];
          properties?: {
            maxUnavailable?: { type?: string[] };
          };
        };
      };
    };
    const pdb = schema.definitions?.pdb;

    expect(pdb?.required).not.toContain('maxUnavailable');
    expect(pdb?.properties?.maxUnavailable?.type).toContain('null');
  });
});
