import { readFileSync, writeFileSync } from 'node:fs';
import { fail } from './check-utils.mjs';

const write = process.argv.includes('--write');
const workspacePath = 'pnpm-workspace.yaml';
const dataPath = process.env.RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE;
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!dataPath) {
  fatal('Dependency policy synchronization failed.', [
    'RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE is required.',
  ]);
}

let upgrades;
try {
  upgrades = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (error) {
  fatal('Dependency policy synchronization failed.', [
    `${dataPath}: ${error instanceof Error ? error.message : String(error)}`,
  ]);
}

if (!Array.isArray(upgrades)) {
  fatal('Dependency policy synchronization failed.', [`${dataPath}: expected a JSON array`]);
}

const replacements = new Map();
for (const upgrade of upgrades) {
  if (String(upgrade?.isVulnerabilityAlert) !== 'true') continue;
  const depName = typeof upgrade.depName === 'string' ? upgrade.depName : undefined;
  const currentVersion =
    typeof upgrade.currentVersion === 'string' ? upgrade.currentVersion : undefined;
  const newVersion = typeof upgrade.newVersion === 'string' ? upgrade.newVersion : undefined;
  if (
    !depName ||
    !currentVersion ||
    !newVersion ||
    !exactVersion.test(currentVersion) ||
    !exactVersion.test(newVersion) ||
    currentVersion === newVersion
  ) {
    continue;
  }
  replacements.set(`${depName}@${currentVersion}`, `${depName}@${newVersion}`);
}

const original = readFileSync(workspacePath, 'utf8');
const lines = original.split(/\r?\n/);
let inExclusions = false;
let changed = false;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line === 'minimumReleaseAgeExclude:') {
    inExclusions = true;
    continue;
  }
  if (inExclusions && line !== '' && !line.startsWith(' ')) {
    inExclusions = false;
  }
  if (!inExclusions) continue;

  const match = /^(\s*-\s+)(['"]?)(.+?)\2\s*$/.exec(line);
  if (!match) continue;
  const replacement = replacements.get(match[3]);
  if (!replacement) continue;
  lines[index] = `${match[1]}${match[2]}${replacement}${match[2]}`;
  changed = true;
}

if (!changed) {
  console.log('Dependency policy synchronization: no reviewed release-age exception changed.');
  process.exit(0);
}

const updated = lines.join('\n');
if (!write) {
  fatal('Dependency policy synchronization failed.', [
    `${workspacePath}: reviewed release-age exception is stale for this vulnerability update`,
  ]);
}
writeFileSync(workspacePath, updated);
console.log('Dependency policy synchronization updated reviewed release-age exceptions.');

function fatal(message, details) {
  fail(message, details);
  process.exit(1);
}
