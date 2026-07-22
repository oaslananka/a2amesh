#!/usr/bin/env node
const classes = [
  ['trusted-publisher-mismatch', /trusted publish|oidc|id-token|provenance/i, false, true, true],
  ['npm-trusted-publisher-mismatch', /npm.*trusted|npm.*provenance|npm.*403/i, false, true, true],
  ['pypi-trusted-publisher-mismatch', /pypi|testpypi|warehouse/i, false, true, true],
  [
    'wrong-package-upload-directory',
    /no such file|upload.*directory|ENOENT.*dist/i,
    true,
    false,
    true,
  ],
  [
    'non-package-assets-sent-to-registry',
    /sbom|sha256|attestation.*publish|invalid package/i,
    true,
    false,
    true,
  ],
  [
    'npm-package-upload-includes-non-package-assets',
    /npm.*sbom|npm.*sha256|npm.*attestation/i,
    true,
    false,
    true,
  ],
  ['workflow syntax/actionlint', /actionlint|workflow is not valid|yaml/i, true, false, false],
  ['zizmor issue', /zizmor/i, true, false, false],
  ['secret scan finding', /gitleaks|secret|private key/i, false, true, true],
  ['CodeQL finding', /codeql|code scanning/i, false, true, true],
  ['dependency audit finding', /audit|vulnerability|CVE-/i, true, false, true],
  ['Docker build failure', /docker build|Dockerfile|buildx/i, true, false, false],
  ['test failure', /test failed|vitest|playwright|assertion/i, true, false, false],
  ['typecheck failure', /tsc|typecheck|typescript/i, true, false, false],
  ['lint failure', /eslint|prettier|markdownlint/i, true, false, false],
  ['package build failure', /unbuild|tsup|build failed|bundle/i, true, false, false],
  ['A2A conformance failure', /a2a|conformance|protocol/i, true, false, true],
  ['MCP metadata drift', /mcp|model context protocol/i, true, false, true],
  ['Cloudflare auth/deploy mismatch', /cloudflare|wrangler/i, false, true, true],
  ['registry auth mismatch', /401|403|auth|permission|scope/i, false, true, true],
  [
    'release tag/version mismatch',
    /tag already exists|version already exists|release.*exists/i,
    false,
    true,
    true,
  ],
  ['VSIX invalid', /vsix|vsce/i, true, false, true],
  ['VS Marketplace publish failure', /marketplace|visual studio/i, false, true, true],
  ['Open VSX publish failure', /open vsx|ovsx/i, false, true, true],
  ['flaky/infra failure', /timeout|ECONNRESET|rate limit|5\d\d/i, false, false, false],
];

const input = process.argv.slice(2).join(' ') || '';
const found = classes.find(([, pattern]) => pattern.test(input));
const [name, , autoFixAllowed, humanApprovalRequired, publishMustStop] = found ?? [
  'unknown',
  /./,
  false,
  true,
  true,
];

const result = {
  class: name,
  root_cause:
    name === 'unknown'
      ? 'No known classifier matched the supplied failure text.'
      : `Matched ${name}.`,
  recommended_fix:
    name === 'unknown'
      ? 'Inspect the failed logs, API response metadata, and official documentation before retrying.'
      : 'Apply the smallest fix for the matched failure class, then rerun the targeted gate.',
  auto_fix_allowed: autoFixAllowed,
  human_approval_required: humanApprovalRequired,
  publish_must_stop: publishMustStop,
};

console.log(JSON.stringify(result, null, 2));
