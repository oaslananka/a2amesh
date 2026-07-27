#!/usr/bin/env node
import { basename } from 'node:path';
import {
  backupSqliteDatabase,
  pruneBackupSets,
  restoreSqliteBackup,
  verifySqliteBackup,
} from './recovery/sqlite-backup.mjs';
import { createDiagnosticBundle, validateDiagnosticBundle } from './recovery/diagnostic-bundle.mjs';

function usage() {
  return `Usage:
  node scripts/recovery-cli.mjs backup --dataset <id> --source <db> --output <dir> [--keep-count <n>]
  node scripts/recovery-cli.mjs verify --manifest <manifest.json>
  node scripts/recovery-cli.mjs restore --manifest <manifest.json> --target <db> [--replace]
  node scripts/recovery-cli.mjs prune --dataset <id> --output <dir> --keep-count <n>
  node scripts/recovery-cli.mjs bundle --manifest <bundle-manifest.json> --source <dir> --output <dir>
  node scripts/recovery-cli.mjs bundle-verify --manifest <bundle-manifest.json> --bundle <dir>`;
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument: ${String(token)}`);
    const key = token.slice(2);
    if (key === 'replace') {
      flags.add(key);
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
    if (values.has(key)) throw new Error(`Duplicate option: --${key}.`);
    values.set(key, value);
    index += 1;
  }
  return { command, values, flags };
}

function requireValue(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required option --${key}.`);
  return value;
}

function parsePositiveInteger(value, key) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsed;
}

function safeResult(value) {
  return JSON.parse(
    JSON.stringify(value, (key, entry) => {
      if (
        typeof entry === 'string' &&
        (key.endsWith('Path') ||
          key.endsWith('File') ||
          key === 'backup' ||
          key === 'manifest' ||
          key === 'original' ||
          key === 'rollback')
      ) {
        return basename(entry);
      }
      if (Array.isArray(entry) && key === 'rollbackFiles') {
        return entry.map((path) => (typeof path === 'string' ? basename(path) : path));
      }
      return entry;
    }),
  );
}

export async function runRecoveryCli(argv = process.argv.slice(2)) {
  const { command, values, flags } = parseArguments(argv);
  switch (command) {
    case 'backup':
      return backupSqliteDatabase({
        dataset: requireValue(values, 'dataset'),
        sourcePath: requireValue(values, 'source'),
        outputDirectory: requireValue(values, 'output'),
        ...(values.has('keep-count')
          ? { keepCount: parsePositiveInteger(requireValue(values, 'keep-count'), 'keep-count') }
          : {}),
      });
    case 'verify':
      return verifySqliteBackup(requireValue(values, 'manifest'));
    case 'restore':
      return restoreSqliteBackup({
        manifestPath: requireValue(values, 'manifest'),
        targetPath: requireValue(values, 'target'),
        replace: flags.has('replace'),
      });
    case 'prune':
      return pruneBackupSets({
        dataset: requireValue(values, 'dataset'),
        outputDirectory: requireValue(values, 'output'),
        keepCount: parsePositiveInteger(requireValue(values, 'keep-count'), 'keep-count'),
      });
    case 'bundle':
      return createDiagnosticBundle({
        manifestPath: requireValue(values, 'manifest'),
        sourceDirectory: requireValue(values, 'source'),
        outputDirectory: requireValue(values, 'output'),
      });
    case 'bundle-verify':
      return validateDiagnosticBundle({
        manifestPath: requireValue(values, 'manifest'),
        bundleDirectory: requireValue(values, 'bundle'),
      });
    default:
      throw new Error(usage());
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRecoveryCli()
    .then((result) => process.stdout.write(`${JSON.stringify(safeResult(result), null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
      );
      process.exitCode = 1;
    });
}
