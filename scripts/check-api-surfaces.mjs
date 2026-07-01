#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const writeMode = process.argv.includes('--write');
const protoPath = 'packages/transport-grpc/proto/a2a.proto';
const protoHashPath = 'packages/transport-grpc/proto/a2a.proto.sha256';
const failures = [];

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(resolve(repoRoot, path))).digest('hex');
}

function checkProtoSurface() {
  const currentHash = sha256(protoPath);
  if (writeMode) {
    writeFileSync(resolve(repoRoot, protoHashPath), `${currentHash}\n`);
    return;
  }

  const expectedHash = readFileSync(resolve(repoRoot, protoHashPath), 'utf8').trim();
  if (currentHash !== expectedHash) {
    failures.push(
      `${protoPath}: protobuf surface drift detected; run pnpm run api:surfaces:write and commit the updated hash.`,
    );
  }

  const proto = readFileSync(resolve(repoRoot, protoPath), 'utf8');
  for (const required of ['service A2AService', 'rpc SendMessage', 'rpc StreamMessage', 'message TaskResponse']) {
    if (!proto.includes(required)) failures.push(`${protoPath}: missing required protobuf surface ${required}`);
  }
}

if (writeMode) {
  run('pnpm', ['run', 'schemas:generate']);
  run('pnpm', ['run', 'openapi:generate']);
} else {
  run('pnpm', ['run', 'schemas:check']);
  run('pnpm', ['run', 'openapi:check']);
}

run('node', ['scripts/check-public-surface.mjs']);
checkProtoSurface();

if (failures.length > 0) {
  console.error('API surface validation failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('API surface validation passed.');
