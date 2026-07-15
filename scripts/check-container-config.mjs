#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { verifyOciAttestations } from './check-oci-attestations.mjs';
import { pruneContainerDeploy } from './prune-container-deploy.mjs';

const dockerfiles = ['apps/demo/Dockerfile', 'packages/registry/Dockerfile'];
const requiredFiles = [
  ...dockerfiles,
  '.github/workflows/containers.yml',
  'compose.dev.yaml',
  'deploy/compose.production.yaml',
  'scripts/prune-container-deploy.mjs',
  'scripts/run-container-smoke.mjs',
  'scripts/check-oci-attestations.mjs',
];
const errors = [];

if (typeof pruneContainerDeploy !== 'function') {
  errors.push('container deploy pruner must export pruneContainerDeploy');
}
if (typeof verifyOciAttestations !== 'function') {
  errors.push('OCI verifier must export verifyOciAttestations');
}

for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    errors.push(`missing required container file: ${file}`);
  }
}

for (const dockerfile of dockerfiles) {
  let content;
  try {
    content = await readFile(dockerfile, 'utf8');
  } catch {
    continue;
  }

  const fromCount = content.match(/^FROM\s+/gm)?.length ?? 0;
  if (fromCount < 2) errors.push(`${dockerfile} must be multi-stage`);
  if (!/node@sha256:[a-f0-9]{64}/.test(content)) {
    errors.push(`${dockerfile} must pin the Node base image by digest`);
  }
  for (const expected of [
    'pnpm install --frozen-lockfile',
    'deploy --prod',
    'rm -rf /usr/local/lib/node_modules/npm',
    'USER 10001:10001',
    'HEALTHCHECK',
    'org.opencontainers.image.version',
    'org.opencontainers.image.revision',
    'org.opencontainers.image.created',
  ]) {
    if (!content.includes(expected)) errors.push(`${dockerfile} is missing: ${expected}`);
  }
}

try {
  const workflow = await readFile('.github/workflows/containers.yml', 'utf8');
  for (const expected of [
    '--provenance=mode=max',
    '--sbom=true',
    'aquasec/trivy@sha256:',
    'subject-digest:',
    'push-to-registry: true',
  ]) {
    if (!workflow.includes(expected)) {
      errors.push(`container workflow is missing: ${expected}`);
    }
  }
} catch {
  // Missing file is reported above.
}

try {
  const smokeScript = await readFile('scripts/run-container-smoke.mjs', 'utf8');
  for (const expected of ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    if (!smokeScript.includes(expected)) {
      errors.push(`container smoke runner is missing: ${expected}`);
    }
  }
} catch {
  // Missing file is reported above.
}

try {
  const productionCompose = await readFile('deploy/compose.production.yaml', 'utf8');
  for (const expected of ['read_only: true', 'cap_drop:', 'no-new-privileges:true', '@sha256:']) {
    if (!productionCompose.includes(expected)) {
      errors.push(`production compose example is missing: ${expected}`);
    }
  }
} catch {
  // Missing file is reported above.
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Container configuration check passed.');
