import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateDependencyFreshness } from '../../scripts/check-dependency-freshness.mjs';

const fixtureRoot = join(process.cwd(), 'tests/fixtures/dependency-freshness');

function readFixture(name: 'patched' | 'vulnerable') {
  const root = join(fixtureRoot, name);
  return {
    audit: JSON.parse(readFileSync(join(root, 'audit.json'), 'utf8')),
    osv: JSON.parse(readFileSync(join(root, 'osv.json'), 'utf8')),
    dependabot: JSON.parse(readFileSync(join(root, 'dependabot.json'), 'utf8')),
  };
}

describe('dependency advisory freshness gate', () => {
  it('passes a patched dependency observation', () => {
    const result = evaluateDependencyFreshness({
      ...readFixture('patched'),
      auditExitCode: 0,
      osvExitCode: 0,
      observedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('No high or critical dependency advisories observed.');
  });

  it('fails for controlled high and critical advisory fixtures', () => {
    const result = evaluateDependencyFreshness({
      ...readFixture('vulnerable'),
      auditExitCode: 1,
      osvExitCode: 1,
      observedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'pnpm audit',
          package: 'fixture-audit-package',
          severity: 'high',
        }),
        expect.objectContaining({
          source: 'OSV',
          package: 'fixture-osv-package',
          severity: 'critical',
        }),
        expect.objectContaining({
          source: 'Dependabot',
          package: 'fixture-python-package',
          severity: 'high',
        }),
      ]),
    );
    expect(result.summary).toContain('fixture-audit-package');
    expect(result.summary).toContain('fixture-osv-package');
    expect(result.summary).toContain('fixture-python-package');
    expect(result.summary).toContain('available');
    expect(result.summary).not.toMatch(
      /private narrative|private summary|private_payload|OSV-FIXTURE-PRIVATE-DETAIL/,
    );
  });

  it('fails closed when a scanner exits unexpectedly without actionable findings', () => {
    const result = evaluateDependencyFreshness({
      ...readFixture('patched'),
      auditExitCode: 2,
      osvExitCode: 0,
      observedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('pnpm audit did not complete successfully');
  });

  it('bounds summary output for large finding sets', () => {
    const fixture = readFixture('patched');
    fixture.dependabot = Array.from({ length: 30 }, (_, index) => ({
      number: index + 1,
      state: 'open',
      dependency: { package: { ecosystem: 'npm', name: `fixture-package-${index + 1}` } },
      security_advisory: { severity: 'high' },
      security_vulnerability: { first_patched_version: { identifier: '2.0.0' } },
    }));

    const result = evaluateDependencyFreshness({
      ...fixture,
      auditExitCode: 0,
      osvExitCode: 0,
      observedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('10 additional findings omitted');
    expect(result.summary.length).toBeLessThan(6000);
  });
});
