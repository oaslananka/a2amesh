import { describe, expect, it } from 'vitest';
import { createDoctorCommand, createDoctorReport } from '../src/commands/doctor.js';
import { expectCommandHelp, jsonOptions } from './command-test-helpers.js';

describe('doctor command', () => {
  it('defines the doctor command', () => {
    const command = createDoctorCommand(jsonOptions);

    expect(command.name()).toBe('doctor');
    expectCommandHelp(command, ['doctor', '--release-gates']);
  });

  it('reports local release gate commands with CI equivalents', () => {
    const report = createDoctorReport({ releaseGates: true });

    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['Node.js version', 'Workspace root', 'Package manager']),
    );
    expect(report.releaseGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'conformance',
          command: 'a2amesh conformance <url> --gate --json',
          ciEquivalent: 'CI / conformance',
        }),
        expect.objectContaining({
          id: 'release-check',
          command: 'a2amesh release-check --json',
        }),
      ]),
    );
  });

});
