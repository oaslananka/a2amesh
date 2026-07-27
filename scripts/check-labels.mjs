import { listFiles, readText, fail } from './check-utils.mjs';

const labelsYaml = readText('.github/labels.yml');
const issueTaxonomy = readText('docs/development/issue-taxonomy.md');
const pullRequestLabeler = readText('.github/labeler.yml');
const failures = [];

const declared = [...labelsYaml.matchAll(/^- name: ['"]([^'"]+)['"]$/gm)].map((match) => match[1]);
const declaredSet = new Set(declared);

if (declared.length !== declaredSet.size) {
  const duplicates = declared.filter((label, index) => declared.indexOf(label) !== index);
  failures.push(`Duplicate labels in .github/labels.yml: ${[...new Set(duplicates)].join(', ')}`);
}

const deprecatedLabels = new Set([
  'adapter',
  'bug',
  'documentation',
  'enhancement',
  'hardening',
  'invalid',
  'question',
  'triage',
  'wontfix',
  'area:deployments',
  'area:devex',
  'area:tests',
]);

for (const label of declared) {
  if (deprecatedLabels.has(label))
    failures.push(`Deprecated label '${label}' must not be declared.`);
}

const documented = [...issueTaxonomy.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .filter(
    (label) =>
      /^(?:pkg|area|type|priority|status):[a-zA-Z0-9-]+$/.test(label) ||
      ['duplicate', 'good first issue', 'help wanted'].includes(label),
  );

for (const label of documented) {
  if (!declaredSet.has(label)) {
    failures.push(
      `Label '${label}' documented in issue-taxonomy.md is missing from .github/labels.yml`,
    );
  }
}

const templateFiles = listFiles().filter(
  (file) => file.startsWith('.github/ISSUE_TEMPLATE/') && file.endsWith('.yml'),
);
const templateRegex = /^labels:\s*\[([^\]]+)\]/m;

for (const file of templateFiles) {
  const content = readText(file);
  const match = content.match(templateRegex);
  if (!match) continue;
  const templateLabels = match[1]
    .split(',')
    .map((label) => label.trim().replace(/^['"]|['"]$/g, ''));
  const typeLabels = templateLabels.filter((label) => label.startsWith('type:'));
  if (typeLabels.length !== 1) {
    failures.push(`${file} must declare exactly one type label; found ${typeLabels.length}.`);
  }
  for (const label of templateLabels) {
    if (!declaredSet.has(label)) {
      failures.push(`Label '${label}' referenced in ${file} is missing from .github/labels.yml`);
    }
    if (deprecatedLabels.has(label))
      failures.push(`Deprecated label '${label}' is referenced in ${file}.`);
  }
}

for (const match of pullRequestLabeler.matchAll(/^'([^']+)':$/gm)) {
  const label = match[1];
  if (!declaredSet.has(label)) {
    failures.push(
      `Label '${label}' referenced in .github/labeler.yml is missing from .github/labels.yml`,
    );
  }
}

// functional labels are intentionally limited and do not replace type/status labels.
const functionalLabels = ['duplicate', 'good first issue', 'help wanted'];
for (const label of functionalLabels) {
  if (!declaredSet.has(label)) failures.push(`Required functional label '${label}' is missing.`);
}

if (failures.length > 0) fail('Label validation failed.', failures);
else console.log(`Label validation passed (${declared.length} canonical labels).`);
