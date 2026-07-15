#!/usr/bin/env node
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const OCI_INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json';
const DOCKER_INDEX_MEDIA_TYPE = 'application/vnd.docker.distribution.manifest.list.v2+json';
const MAX_JSON_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_ATTESTATION_BLOB_BYTES = 64 * 1024 * 1024;

function layoutDirectoryFor(component) {
  switch (component) {
    case 'runtime':
      return 'runtime-oci';
    case 'registry':
      return 'registry-oci';
    default:
      throw new Error(`Unsupported OCI component: ${component}`);
  }
}

function assertContainedPath(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error('OCI layout resolves outside the trusted working directory.');
  }
}

async function resolveLayoutRoot(component) {
  const trustedRoot = await realpath(process.cwd());
  const requestedPath = join(trustedRoot, layoutDirectoryFor(component));
  const requestedInfo = await lstat(requestedPath);
  if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) {
    throw new Error('OCI layout must be a real directory.');
  }

  const layoutRoot = await realpath(requestedPath);
  assertContainedPath(trustedRoot, layoutRoot);
  return layoutRoot;
}

function blobPath(layoutRoot, digest) {
  const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
  if (!match) {
    throw new Error(`Unsupported OCI digest: ${digest}`);
  }
  return join(layoutRoot, 'blobs', 'sha256', match[1]);
}

async function readBoundedText(path, maximumBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('OCI blob must be a regular file.');
  }
  if (info.size > maximumBytes) {
    throw new Error(`OCI blob exceeds the ${maximumBytes}-byte verification limit.`);
  }
  return readFile(path, 'utf8');
}

async function readJson(layoutRoot, digestOrName) {
  const path = digestOrName.includes(':')
    ? blobPath(layoutRoot, digestOrName)
    : join(layoutRoot, digestOrName);
  return JSON.parse(await readBoundedText(path, MAX_JSON_BLOB_BYTES));
}

function isIndexDescriptor(descriptor) {
  return [OCI_INDEX_MEDIA_TYPE, DOCKER_INDEX_MEDIA_TYPE].includes(descriptor.mediaType);
}

async function flattenDescriptors(layoutRoot, descriptors, visited = new Set()) {
  const flattened = [];
  for (const descriptor of descriptors ?? []) {
    if (!descriptor?.digest || visited.has(descriptor.digest)) continue;
    visited.add(descriptor.digest);

    if (!isIndexDescriptor(descriptor)) {
      flattened.push(descriptor);
      continue;
    }

    const nestedIndex = await readJson(layoutRoot, descriptor.digest);
    flattened.push(...(await flattenDescriptors(layoutRoot, nestedIndex.manifests, visited)));
  }
  return flattened;
}

export async function verifyOciAttestations(component) {
  const layoutRoot = await resolveLayoutRoot(component);
  const index = await readJson(layoutRoot, 'index.json');
  if (!Array.isArray(index.manifests) || index.manifests.length === 0) {
    throw new Error('OCI layout does not contain image manifests.');
  }

  const descriptors = await flattenDescriptors(layoutRoot, index.manifests);
  const imageManifests = descriptors.filter(
    (manifest) =>
      manifest.platform?.os !== 'unknown' && manifest.platform?.architecture !== 'unknown',
  );
  const attestationManifests = descriptors.filter(
    (manifest) => manifest.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest',
  );

  if (imageManifests.length === 0) {
    throw new Error('OCI layout is missing a runnable image manifest.');
  }
  if (attestationManifests.length === 0) {
    throw new Error('OCI layout is missing BuildKit attestation manifests.');
  }

  const predicateTypes = new Set();
  for (const descriptor of attestationManifests) {
    const manifest = await readJson(layoutRoot, descriptor.digest);
    for (const layer of manifest.layers ?? []) {
      const annotatedType = layer.annotations?.['in-toto.io/predicate-type'];
      if (annotatedType) predicateTypes.add(annotatedType);

      const payload = await readBoundedText(
        blobPath(layoutRoot, layer.digest),
        MAX_ATTESTATION_BLOB_BYTES,
      );
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

  const sortedPredicateTypes = [...predicateTypes].sort((left, right) => left.localeCompare(right));
  process.stdout.write(`OCI attestations verified: ${sortedPredicateTypes.join(', ')}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const component = process.argv[2];
  if (!component) {
    process.stderr.write('Usage: node scripts/check-oci-attestations.mjs <runtime|registry>\n');
    process.exit(2);
  }

  await verifyOciAttestations(component);
}
