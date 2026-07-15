#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function blobPath(layoutRoot, digest) {
  const [algorithm, value] = digest.split(':');
  if (algorithm !== 'sha256' || !value) {
    throw new Error(`Unsupported OCI digest: ${digest}`);
  }
  return join(layoutRoot, 'blobs', algorithm, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    process.stderr.write('Usage: node scripts/check-oci-attestations.mjs <extracted-oci-layout>\n');
    process.exit(2);
  }

  const layoutRoot = resolve(input);
  const index = await readJson(join(layoutRoot, 'index.json'));
  if (!Array.isArray(index.manifests) || index.manifests.length === 0) {
    throw new Error('OCI layout does not contain image manifests.');
  }

  const imageManifests = index.manifests.filter(
    (manifest) =>
      manifest.platform?.os !== 'unknown' && manifest.platform?.architecture !== 'unknown',
  );
  const attestationManifests = index.manifests.filter(
    (manifest) => manifest.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest',
  );

  if (imageManifests.length === 0)
    throw new Error('OCI layout is missing a runnable image manifest.');
  if (attestationManifests.length === 0) {
    throw new Error('OCI layout is missing BuildKit attestation manifests.');
  }

  const predicateTypes = new Set();
  for (const descriptor of attestationManifests) {
    const manifest = await readJson(blobPath(layoutRoot, descriptor.digest));
    for (const layer of manifest.layers ?? []) {
      const payload = await readFile(blobPath(layoutRoot, layer.digest), 'utf8');
      for (const match of payload.matchAll(/"predicateType"\s*:\s*"([^"]+)"/g)) {
        predicateTypes.add(match[1]);
      }
    }
  }

  const hasSbom = [...predicateTypes].some((value) => value.includes('spdx.dev/Document'));
  const hasProvenance = [...predicateTypes].some((value) => value.includes('slsa.dev/provenance'));
  if (!hasSbom || !hasProvenance) {
    const blobs = await readdir(join(layoutRoot, 'blobs', 'sha256'));
    throw new Error(
      `OCI attestations incomplete (SBOM=${hasSbom}, provenance=${hasProvenance}, predicates=${
        [...predicateTypes].join(', ') || '<none>'
      }, blobs=${blobs.length}).`,
    );
  }

  process.stdout.write(`OCI attestations verified: ${[...predicateTypes].sort().join(', ')}\n`);
}

await main();
