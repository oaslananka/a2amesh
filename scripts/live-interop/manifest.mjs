import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EXACT_RUNTIME_VERSION = /^\d+\.\d+\.\d+$/;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireString(errors, object, key, owner) {
  if (typeof object?.[key] !== 'string' || object[key].length === 0) {
    errors.push(`${owner ? `${owner}.` : ''}${key} must be a non-empty string`);
  }
}

export function validateLiveInteropManifest(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ['manifest must be an object'];
  }

  requireString(errors, value, 'schemaVersion', '');
  requireString(errors, value, 'protocolVersion', '');
  requireString(errors, value, 'nodeVersion', '');
  requireString(errors, value, 'pythonVersion', '');

  for (const key of ['nodeVersion', 'pythonVersion']) {
    if (typeof value[key] === 'string' && !EXACT_RUNTIME_VERSION.test(value[key])) {
      errors.push(`${key} must be an exact three-part version`);
    }
  }

  if (value.protocolVersion !== '1.0') {
    errors.push('protocolVersion must equal 1.0');
  }

  for (const [ecosystem, expectedPackage] of [
    ['javascript', '@a2a-js/sdk'],
    ['python', 'a2a-sdk'],
  ]) {
    const entry = value[ecosystem];
    if (!isRecord(entry)) {
      errors.push(`${ecosystem} must be an object`);
      continue;
    }
    requireString(errors, entry, 'package', ecosystem);
    requireString(errors, entry, 'version', ecosystem);
    if (entry.package !== expectedPackage) {
      errors.push(`${ecosystem}.package must equal ${expectedPackage}`);
    }
    if (typeof entry.version === 'string' && !EXACT_SEMVER.test(entry.version)) {
      errors.push(`${ecosystem}.version must be an exact semantic version`);
    }
  }

  return errors;
}

export async function loadLiveInteropManifest(root = process.cwd()) {
  const manifestPath = path.join(root, 'tests/interop/live/versions.json');
  const value = JSON.parse(await readFile(manifestPath, 'utf8'));
  const errors = validateLiveInteropManifest(value);
  if (errors.length > 0) {
    throw new Error(`Invalid live interop manifest:\n- ${errors.join('\n- ')}`);
  }
  return value;
}
