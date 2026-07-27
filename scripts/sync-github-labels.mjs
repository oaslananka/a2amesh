import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
const check = process.argv.includes('--check') || (!apply && !dryRun);

const ghCandidates =
  process.platform === 'win32'
    ? ['C:\\Program Files\\GitHub CLI\\gh.exe']
    : ['/usr/bin/gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
const ghExecutable = ghCandidates.find((candidate) => existsSync(candidate));

if (!ghExecutable) {
  throw new Error(
    `GitHub CLI was not found in an approved system location: ${ghCandidates.join(', ')}`,
  );
}

function runGh(args) {
  const result = spawnSync(ghExecutable, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh ${args.join(' ')} failed`);
  return result.stdout;
}

function parseSingleQuotedValue(line, prefix) {
  const encoded = line.slice(prefix.length).trim();
  if (!encoded.startsWith("'") || !encoded.endsWith("'")) {
    throw new Error(`Expected a single-quoted value after ${prefix.trim()}: ${line}`);
  }
  return encoded.slice(1, -1);
}

function completeLabel(label) {
  if (!label?.name || !label.color) {
    throw new Error(`Incomplete label declaration: ${JSON.stringify(label)}`);
  }
  return {
    name: label.name,
    color: label.color.toLowerCase(),
    description: label.description ?? '',
  };
}

function parseLabels(source) {
  const labels = [];
  let current;

  for (const line of source.split('\n')) {
    if (line.startsWith('- name: ')) {
      if (current) labels.push(completeLabel(current));
      current = { name: parseSingleQuotedValue(line, '- name: ') };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('  color: ')) {
      current.color = parseSingleQuotedValue(line, '  color: ');
      continue;
    }
    if (line.startsWith('  description: ')) {
      current.description = parseSingleQuotedValue(line, '  description: ');
    }
  }

  if (current) labels.push(completeLabel(current));
  return labels;
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
