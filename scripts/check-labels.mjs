import { listFiles, readText, fail } from './check-utils.mjs';

const labelsYaml = readText('.github/labels.yml');
const issueTaxonomy = readText('docs/development/issue-taxonomy.md');

const failures = [];

// Extract labels from issue-taxonomy.md formatted as `label:name`
const taxonomyRegex = /`((?:product|area|type|risk):[a-zA-Z0-9-\*]+)`/g;
const taxonomyMatches = [...issueTaxonomy.matchAll(taxonomyRegex)].map((m) => m[1]);

for (const label of taxonomyMatches) {
  if (!label.endsWith('-*') && !labelsYaml.includes(`- name: '${label}'`)) {
    failures.push(
      `Label '${label}' documented in issue-taxonomy.md is missing from .github/labels.yml`,
    );
  }
}

const templateFiles = listFiles().filter(
  (file) => file.startsWith('.github/ISSUE_TEMPLATE/') && file.endsWith('.yml'),
);
const templateRegex = /labels:\s*\[([^\]]+)\]/;

for (const file of templateFiles) {
  const content = readText(file);
  const match = content.match(templateRegex);
  if (match) {
    const templateLabels = match[1].split(',').map((l) => l.trim().replace(/^['"]|['"]$/g, ''));
    for (const label of templateLabels) {
      if (label.includes(':') && !labelsYaml.includes(`- name: '${label}'`)) {
        failures.push(`Label '${label}' referenced in ${file} is missing from .github/labels.yml`);
      }
    }
  }
}

if (failures.length > 0) {
  fail('Label validation failed.', failures);
} else {
  console.log('Label validation passed.');
}
