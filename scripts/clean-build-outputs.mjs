import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getWorkspacePackages } from './check-utils.mjs';

const workspaceDirectories = getWorkspacePackages()
  .filter((entry) => entry.path !== 'package.json')
  .map((entry) => entry.dir);

const targets = new Set();
for (const directory of workspaceDirectories) {
  targets.add(resolve(directory, 'dist'));
  targets.add(resolve(directory, 'tsconfig.tsbuildinfo'));
  targets.add(resolve(directory, 'node_modules/.cache/tsconfig.tsbuildinfo'));
}
targets.add(resolve('docs-site/.vitepress/dist'));
targets.add(resolve('.artifacts/build'));

await Promise.all([...targets].map((target) => rm(target, { recursive: true, force: true })));
process.stdout.write(`Removed ${targets.size} build output locations.\n`);
