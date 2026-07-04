import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const docPaths = ['docs/compatibility.md', 'docs-site/guide/compatibility.md'].map((path) => join(repoRoot, path));
const cliPackagePath = join(repoRoot, 'packages/cli/package.json');
const targetVersion = JSON.parse(readFileSync(cliPackagePath, 'utf8')).version;
const startToken = 'All public packages in the `';
const endToken = '` release line share';

for (const docPath of docPaths) {
  const doc = readFileSync(docPath, 'utf8');
  const start = doc.indexOf(startToken);
  if (start < 0) throw new Error('Could not find the Package Version Matrix release line in ' + docPath);
  const versionStart = start + startToken.length;
  const versionEnd = doc.indexOf(endToken, versionStart);
  if (versionEnd < 0) throw new Error('Could not find the Package Version Matrix release line in ' + docPath);
  const currentVersion = doc.slice(versionStart, versionEnd);
  if (currentVersion === targetVersion) continue;
  const updated = doc.split('`' + currentVersion + '`').join('`' + targetVersion + '`');
  writeFileSync(docPath, updated);
  console.log('Updated ' + docPath + ' Package Version Matrix: ' + currentVersion + ' -> ' + targetVersion);
}
