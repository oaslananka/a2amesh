import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
const check = process.argv.includes('--check') || (!apply && !dryRun);

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh ${args.join(' ')} failed`);
  return result.stdout;
}

function parseLabels(source) {
  return source
    .split(/(?=^- name: )/m)
    .filter((block) => block.startsWith('- name:'))
    .map((block) => {
      const name = block.match(/^- name: ['"]([^'"]+)['"]/m)?.[1];
      const color = block.match(/^\s+color: ['"]([0-9a-fA-F]{6})['"]/m)?.[1];
      const description = block.match(/^\s+description: ['"]([^'"]*)['"]/m)?.[1] ?? '';
      if (!name || !color) throw new Error(`Invalid label block:\n${block}`);
      return { name, color: color.toLowerCase(), description };
    });
}

function resolveRepository() {
  const index = process.argv.indexOf('--repo');
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
}

const desired = parseLabels(readFileSync('.github/labels.yml', 'utf8'));
const desiredByName = new Map(desired.map((label) => [label.name, label]));
const repository = resolveRepository();
const live = JSON.parse(
  runGh([
    'label',
    'list',
    '--repo',
    repository,
    '--limit',
    '1000',
    '--json',
    'name,color,description',
  ]),
).map((label) => ({
  name: label.name,
  color: label.color.toLowerCase(),
  description: label.description ?? '',
}));
const liveByName = new Map(live.map((label) => [label.name, label]));
const create = desired.filter((label) => !liveByName.has(label.name));
const update = desired.filter((label) => {
  const current = liveByName.get(label.name);
  return current && (current.color !== label.color || current.description !== label.description);
});
const remove = live.filter((label) => !desiredByName.has(label.name));

console.log(`Repository: ${repository}`);
console.log(`Canonical labels: ${desired.length}; live labels: ${live.length}`);
for (const label of create) console.log(`CREATE ${label.name}`);
for (const label of update) console.log(`UPDATE ${label.name}`);
for (const label of remove) console.log(`DELETE ${label.name}`);

if (create.length + update.length + remove.length === 0) {
  console.log('Live labels match .github/labels.yml.');
  process.exit(0);
}
if (dryRun) {
  console.log('Dry run only; no live labels changed.');
  process.exit(0);
}
if (check) {
  console.error(
    'Live label drift detected. Run `pnpm run labels:preview`, then `pnpm run labels:apply`.',
  );
  process.exit(1);
}

for (const label of create) {
  runGh([
    'api',
    '--method',
    'POST',
    `repos/${repository}/labels`,
    '-f',
    `name=${label.name}`,
    '-f',
    `color=${label.color}`,
    '-f',
    `description=${label.description}`,
  ]);
}
for (const label of update) {
  runGh([
    'api',
    '--method',
    'PATCH',
    `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
    '-f',
    `new_name=${label.name}`,
    '-f',
    `color=${label.color}`,
    '-f',
    `description=${label.description}`,
  ]);
}
for (const label of remove) {
  runGh([
    'api',
    '--method',
    'DELETE',
    `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
  ]);
}
console.log('Live labels reconciled successfully.');
