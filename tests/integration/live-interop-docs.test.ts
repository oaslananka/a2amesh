import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/interop-lab.yml', 'utf8');
const officialDocs = readFileSync('docs/interop/official-sdks.md', 'utf8');
const compatibility = readFileSync('docs/compatibility.md', 'utf8');
const manifest = JSON.parse(readFileSync('tests/interop/live/versions.json', 'utf8')) as {
  nodeVersion: string;
  pythonVersion: string;
  protocolVersion: string;
  javascript: { package: string; version: string };
  python: { package: string; version: string };
};

describe('live SDK interoperability workflow and documentation', () => {
  it('keeps fixture replay and live execution guarantees distinct', () => {
    expect(workflow).toContain('Interop Lab / official SDK fixture replay');
    expect(workflow).toContain('Interop Lab / live official JavaScript SDK');
    expect(workflow).toContain('Interop Lab / live official Python SDK');
    expect(officialDocs).toContain('Fixture replay guarantee');
    expect(officialDocs).toContain('Live official SDK guarantee');
    expect(officialDocs).not.toContain('Future live SDK containers');
  });

  it('pins the exact manifest runtimes and SDK dependencies in CI', () => {
    expect(workflow).toContain(`NODE_VERSION: '${manifest.nodeVersion}'`);
    expect(workflow).toContain(`PYTHON_VERSION: '${manifest.pythonVersion}'`);
    expect(workflow).toContain(`node-version: \${{ env.NODE_VERSION }}`);
    expect(workflow).toContain(`python-version: \${{ env.PYTHON_VERSION }}`);
    expect(workflow).toContain('npm ci --ignore-scripts');
    expect(workflow).toContain(
      'pip install --disable-pip-version-check --requirement tests/interop/live/python/requirements.txt',
    );
    expect(officialDocs).toContain(
      `\`${manifest.javascript.package}@${manifest.javascript.version}\``,
    );
    expect(officialDocs).toContain(`\`${manifest.python.package}==${manifest.python.version}\``);
    expect(compatibility).toContain(`\`${manifest.protocolVersion}\``);
  });

  it('uploads isolated reports and diagnostics even after failures', () => {
    expect(workflow).toContain('name: interop-live-javascript-report');
    expect(workflow).toContain('name: interop-live-python-report');
    expect(workflow.match(/if: \$\{\{ always\(\) \}\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow.match(/if-no-files-found: error/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toContain('artifacts/interop-live/javascript/report.json');
    expect(workflow).toContain('artifacts/interop-live/python/report.json');
  });
});
