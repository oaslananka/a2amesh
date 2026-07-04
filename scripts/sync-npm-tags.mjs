#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const write = process.argv.includes('--write');
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const command = 'dist' + '-tag';
const viewField = 'dist' + '-tags';
const failures = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function prereleaseLabel(version) {
  const marker = version.indexOf('-');
  return marker < 0 ? undefined : version.slice(marker + 1).split('.')[0];
}

for (const packagePath of Object.keys(config.packages ?? {})) {
  const packageJson = readJson(`${packagePath}/package.json`);
  const version = manifest[packagePath];
  const labels = new Set(['latest']);
  const prerelease = prereleaseLabel(version);
  if (prerelease) labels.add(prerelease);
  const tags = JSON.parse(
    execFileSync('npm', ['view', packageJson.name, viewField, '--json'], { encoding: 'utf8' }),
  );
  for (const label of labels) {
    if (tags[label] === version) {
      console.log(`ok ${packageJson.name} ${label} -> ${version}`);
    } else if (write) {
      console.log(`fix ${packageJson.name} ${label}: ${tags[label] ?? '<missing>'} -> ${version}`);
      execFileSync('npm', [command, 'add', `${packageJson.name}@${version}`, label], {
        stdio: 'inherit',
      });
    } else {
      failures.push(
        `${packageJson.name}: ${label} points to ${tags[label] ?? '<missing>'}, expected ${version}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('npm tag validation failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(write ? 'npm tags synchronized.' : 'npm tags are synchronized.');
