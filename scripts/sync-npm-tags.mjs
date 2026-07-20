#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expectedDistTag } from './release-state-core.mjs';

const write = process.argv.includes('--write');
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const command = 'dist' + '-tag';
const viewField = 'dist' + '-tags';
const failures = [];
const npmExecutable = join(
  dirname(process.execPath),
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

for (const packagePath of Object.keys(config.packages ?? {})) {
  const packageJson = readJson(`${packagePath}/package.json`);
  const version = manifest[packagePath];
  const expectedTag = expectedDistTag(version);
  const tags = JSON.parse(
    execFileSync(npmExecutable, ['view', packageJson.name, viewField, '--json'], {
      encoding: 'utf8',
    }),
  );

  if (tags[expectedTag] === version) {
    console.log(`ok ${packageJson.name} ${expectedTag} -> ${version}`);
  } else if (write) {
    console.log(
      `fix ${packageJson.name} ${expectedTag}: ${tags[expectedTag] ?? '<missing>'} -> ${version}`,
    );
    execFileSync(npmExecutable, [command, 'add', `${packageJson.name}@${version}`, expectedTag], {
      stdio: 'inherit',
    });
  } else {
    failures.push(
      `${packageJson.name}: ${expectedTag} points to ${tags[expectedTag] ?? '<missing>'}, expected ${version}`,
    );
  }

  if (expectedTag !== 'latest' && tags.latest === version) {
    failures.push(`${packageJson.name}: latest must not point to prerelease ${version}`);
  }
}

if (failures.length > 0) {
  console.error('npm tag validation failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(write ? 'npm tags synchronized.' : 'npm tags are synchronized.');
