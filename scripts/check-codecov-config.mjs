import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const COVERAGE_ACTION_SHA = 'fb8b3582c8e4def4969c97caa2f19720cb33a72f';

export function validateCodecovPolicy({
  codecovYaml,
  ciWorkflow,
  packageJson,
  ruleset,
  bundleUploader,
  documentation,
}) {
  const failures = [];
  validateCodecovYaml(codecovYaml, failures);
  validateWorkflow(ciWorkflow, failures);
  validatePackage(packageJson, failures);
  validateRuleset(ruleset, failures);
  validateBundleUploader(bundleUploader, failures);
  validateDocumentation(documentation, failures);
  return failures;
}

function validateCodecovYaml(codecovYaml, failures) {
  const informationalStatuses = codecovYaml.match(/informational:\s*true/g) ?? [];
  if (informationalStatuses.length < 2 || /informational:\s*false/.test(codecovYaml)) {
    failures.push('Codecov project and patch statuses must remain informational');
  }
  if (!/project:[\s\S]*?target:\s*auto[\s\S]*?threshold:\s*1%/.test(codecovYaml)) {
    failures.push('Codecov project status must compare against the base with a 1% threshold');
  }
  if (!/patch:[\s\S]*?target:\s*auto[\s\S]*?threshold:\s*1%/.test(codecovYaml)) {
    failures.push('Codecov patch status must use an automatic target with a 1% threshold');
  }
  if (
    !/bundle_analysis:[\s\S]*?warning_threshold:\s*['"]5%['"][\s\S]*?status:\s*informational/.test(
      codecovYaml,
    )
  ) {
    failures.push('Codecov bundle status must remain informational with a 5% warning threshold');
  }
  if (!/flags:[\s\S]*?unit:[\s\S]*?paths:[\s\S]*?- packages\//.test(codecovYaml)) {
    failures.push('Codecov unit coverage must remain scoped to packages/');
  }
}

function validateWorkflow(ciWorkflow, failures) {
  const pinnedActionUses =
    ciWorkflow.match(new RegExp(`codecov/codecov-action@${COVERAGE_ACTION_SHA}`, 'g')) ?? [];
  if (pinnedActionUses.length !== 2) {
    failures.push('Coverage and test-result uploads must use the approved Codecov action SHA');
  }
  if (ciWorkflow.includes('codecov/test-results-action@')) {
    failures.push('The deprecated Codecov test-results action must not be used');
  }
  if (!/report_type:\s*test_results/.test(ciWorkflow)) {
    failures.push('The JUnit upload must declare the Codecov test_results report type');
  }
  if (!ciWorkflow.includes("CODECOV_CLI_VERSION: 'v11.3.1'")) {
    failures.push('Codecov CLI must remain pinned to v11.3.1');
  }
  const pinnedCliInputs =
    ciWorkflow.match(/version:\s*\$\{\{ env\.CODECOV_CLI_VERSION \}\}/g) ?? [];
  if (pinnedCliInputs.length !== 2) {
    failures.push('Coverage and test-result actions must use the pinned Codecov CLI version');
  }
  if (!ciWorkflow.includes('pnpm run test:coverage:ci')) {
    failures.push('CI must generate coverage and JUnit results in one unit-test execution');
  }
  const tokenAwareUploads =
    ciWorkflow.match(/if:\s*\$\{\{ !cancelled\(\) && env\.CODECOV_TOKEN != '' \}\}/g) ?? [];
  if (tokenAwareUploads.length !== 2) {
    failures.push('Coverage and failed-test uploads must use token-aware !cancelled() guards');
  }
  if (!ciWorkflow.includes('files: ./coverage/lcov.info')) {
    failures.push('CI must upload only the generated LCOV report');
  }
  if (!ciWorkflow.includes('files: ./test-results/unit.junit.xml')) {
    failures.push('CI must upload the generated JUnit report for Test Analytics');
  }
  if (!ciWorkflow.includes("CODECOV_BUNDLE_ANALYSIS: 'true'")) {
    failures.push('CI must explicitly enable bundle analysis only in the unit upload step');
  }
  const unitStart = ciWorkflow.indexOf('\n  unit:');
  const integrationStart = ciWorkflow.indexOf('\n  integration:');
  const buildStart = ciWorkflow.indexOf('\n  build:');
  const packageDryRunStart = ciWorkflow.indexOf('\n  package-dry-run:');
  const unitBlock = ciWorkflow.slice(unitStart, integrationStart);
  const buildBlock = ciWorkflow.slice(buildStart, packageDryRunStart);
  const coverageUpload = unitBlock.indexOf('Upload unit coverage to Codecov');
  const testResultsUpload = unitBlock.indexOf('Upload unit test results to Codecov');
  const bundleUpload = unitBlock.indexOf('Upload JavaScript bundle analysis to Codecov');
  if (
    !(coverageUpload >= 0 && coverageUpload < testResultsUpload && testResultsUpload < bundleUpload)
  ) {
    failures.push('Bundle analysis must run after coverage and Test Analytics in CI / unit');
  }
  if (buildBlock.includes('codecov:bundle') || buildBlock.includes('CODECOV_TOKEN')) {
    failures.push('CI / build must remain independent from Codecov upload ordering');
  }
  if (!unitBlock.includes('fetch-depth: 2')) {
    failures.push('The Codecov unit checkout must retain two commits for bundle metadata');
  }
  if (!/permissions:\s*[\s\S]*?contents:\s*read[\s\S]*?id-token:\s*write/.test(unitBlock)) {
    failures.push('The Codecov unit job must grant only read contents and OIDC token permissions');
  }
  const bundleGuard =
    "if: ${{ !cancelled() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}";
  if (!unitBlock.includes(bundleGuard)) {
    failures.push('Bundle analysis must use a fork-safe GitHub OIDC guard');
  }
  for (const metadata of [
    'CODECOV_BUNDLE_BRANCH:',
    'CODECOV_BUNDLE_PR:',
    'CODECOV_BUNDLE_SHA:',
    'CODECOV_BUNDLE_SLUG:',
  ]) {
    if (!unitBlock.includes(metadata)) {
      failures.push(`The Codecov unit job is missing bundle metadata: ${metadata}`);
    }
  }
}

function validatePackage(packageJson, failures) {
  let pkg;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    failures.push('package.json must be valid JSON');
    return;
  }
  if (pkg.optionalDependencies?.['@codecov/bundle-analyzer'] !== '2.0.1') {
    failures.push('Codecov bundle analyzer must be an exact optional dependency at 2.0.1');
  }
  if (pkg.devDependencies?.['@codecov/vite-plugin']) {
    failures.push('The Vite 4-6 Codecov plugin must not be used with Vite 8');
  }
  const coverageScript = pkg.scripts?.['test:coverage:ci'] ?? '';
  if (
    !coverageScript.includes('--reporter=junit') ||
    !coverageScript.includes('--outputFile.junit=./test-results/unit.junit.xml')
  ) {
    failures.push('The CI coverage script must emit JUnit XML for Test Analytics');
  }
  if (pkg.scripts?.['codecov:bundle'] !== 'node scripts/upload-codecov-bundles.mjs') {
    failures.push('The Codecov bundle script must use the repository uploader');
  }
}

function validateRuleset(ruleset, failures) {
  if (/codecov\/(project|patch|bundle)/i.test(ruleset)) {
    failures.push(
      'Codecov contexts must not be required while Sonar and local thresholds remain active',
    );
  }
}

function validateBundleUploader(bundleUploader, failures) {
  for (const expected of [
    "bundleName: 'registry-ui'",
    "bundleName: 'mission-control'",
    "'apps/registry-ui/dist'",
    "'apps/mission-control/dist'",
    "ignorePatterns: ['**/*.map']",
    'enableBundleAnalysis: true',
    'retryCount: 6',
    'oidc: { useGitHubOIDC }',
    'uploadOverrides,',
    'GITHUB_ACTIONS',
    'CODECOV_BUNDLE_BRANCH',
    'CODECOV_BUNDLE_SHA',
    'CODECOV_BUNDLE_SLUG',
    "gitService: 'github'",
  ]) {
    if (!bundleUploader.includes(expected)) {
      failures.push(`Codecov bundle uploader is missing: ${expected}`);
    }
  }
  if (!bundleUploader.includes('CODECOV_BUNDLE_ANALYSIS')) {
    failures.push('Codecov bundle uploads must require the explicit CI enable flag');
  }
  if (bundleUploader.includes('CODECOV_TOKEN') || bundleUploader.includes('uploadToken')) {
    failures.push('Codecov bundle uploads must use GitHub OIDC instead of the coverage token');
  }
  if (!bundleUploader.includes('Real Codecov bundle uploads require GitHub Actions OIDC.')) {
    failures.push('Codecov bundle uploads must fail closed outside GitHub Actions OIDC');
  }
}

function validateDocumentation(documentation, failures) {
  for (const expected of [
    'informational',
    'CODECOV_TOKEN',
    'GitHub App',
    'GitHub OIDC',
    'Test Analytics',
    'Bundle Analysis',
    '#148',
  ]) {
    if (!documentation.includes(expected)) {
      failures.push(`Codecov documentation must mention ${expected}`);
    }
  }
}

function runCli() {
  const failures = validateCodecovPolicy({
    codecovYaml: readFileSync('codecov.yml', 'utf8'),
    ciWorkflow: readFileSync('.github/workflows/ci.yml', 'utf8'),
    packageJson: readFileSync('package.json', 'utf8'),
    ruleset: readFileSync('.github/rulesets/main.json', 'utf8'),
    bundleUploader: readFileSync('scripts/upload-codecov-bundles.mjs', 'utf8'),
    documentation: readFileSync('docs/development/codecov.md', 'utf8'),
  });
  if (failures.length > 0) {
    console.error('Codecov policy validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('Codecov policy validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
