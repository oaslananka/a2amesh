import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const docPath = join(repoRoot, 'docs/compatibility.md');
const cliPackagePath = join(repoRoot, 'packages/cli/package.json');

const targetVersion = JSON.parse(readFileSync(cliPackagePath, 'utf8')).version;
const doc = readFileSync(docPath, 'utf8');

const releaseLineMatch = doc.match(/All public packages in the `([^`]+)` release line share/);
if (!releaseLineMatch) {
  console.error('Could not find the Package Version Matrix release line in docs/compatibility.md');
  process.exit(1);
}
const currentVersion = releaseLineMatch[1];

if (currentVersion === targetVersion) {
  process.exit(0);
}

const updated = doc.split(`\`${currentVersion}\``).join(`\`${targetVersion}\``);
writeFileSync(docPath, updated);
console.log(`Updated docs/compatibility.md Package Version Matrix: ${currentVersion} -> ${targetVersion}`);
