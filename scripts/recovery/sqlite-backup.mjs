import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const MANIFEST_SCHEMA_VERSION = 1;
const DATASET_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm'];
const DEFAULT_SIDECAR_FILE_OPERATIONS = Object.freeze({ rm });
const DEFAULT_RESTORE_FILE_OPERATIONS = Object.freeze({ chmod, copyFile, rename, rm });

function timestampSlug(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Recovery timestamp must be a valid Date.');
  }
  return date.toISOString().replaceAll(':', '-').replace('.', '-');
}

function assertDataset(dataset) {
  if (typeof dataset !== 'string' || !DATASET_PATTERN.test(dataset)) {
    throw new Error('dataset must match /^[a-z0-9][a-z0-9._-]{0,63}$/');
  }
}

async function assertRegularFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link.`);
  }
  return details;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeSqliteSidecars(path, fileOperations = DEFAULT_SIDECAR_FILE_OPERATIONS) {
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => fileOperations.rm(`${path}${suffix}`, { force: true })),
  );
}

async function inspectTransientSqliteDatabase(
  path,
  fileOperations = DEFAULT_SIDECAR_FILE_OPERATIONS,
) {
  try {
    return inspectSqliteDatabase(path);
  } finally {
    await removeSqliteSidecars(path, fileOperations);
  }
}

async function sha256(path) {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

function pragmaScalar(database, pragma, key) {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  if (!row || typeof row !== 'object' || !(key in row)) {
    throw new Error(`SQLite did not return PRAGMA ${pragma}.`);
  }
  return row[key];
}

function inspectSqliteDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = database.prepare('PRAGMA quick_check').all();
    const values = rows.flatMap((row) => Object.values(row));
    const quickCheck = values.join(',');
    if (values.length !== 1 || values[0] !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${quickCheck || 'no result'}`);
    }
    return {
      quickCheck: 'ok',
      pageCount: Number(pragmaScalar(database, 'page_count', 'page_count')),
      pageSize: Number(pragmaScalar(database, 'page_size', 'page_size')),
      journalMode: String(pragmaScalar(database, 'journal_mode', 'journal_mode')),
      userVersion: Number(pragmaScalar(database, 'user_version', 'user_version')),
    };
  } finally {
    database.close();
  }
}

function parseManifestDocument(document, manifestPath) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`Invalid SQLite backup manifest: ${manifestPath}`);
  }
  if (document.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite backup manifest schema: ${document.schemaVersion}`);
  }
  assertDataset(document.dataset);
  if (
    typeof document.backupFile !== 'string' ||
    document.backupFile !== basename(document.backupFile) ||
    isAbsolute(document.backupFile)
  ) {
    throw new Error('Backup manifest must contain a safe relative backupFile basename.');
  }
  if (typeof document.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(document.sha256)) {
    throw new Error('Backup manifest must contain a lowercase SHA-256 digest.');
  }
  if (!Number.isSafeInteger(document.sizeBytes) || document.sizeBytes <= 0) {
    throw new Error('Backup manifest sizeBytes must be a positive integer.');
  }
  if (typeof document.createdAt !== 'string') {
    throw new TypeError('Backup manifest createdAt must be a string.');
  }
  if (Number.isNaN(Date.parse(document.createdAt))) {
    throw new Error('Backup manifest createdAt must be an ISO timestamp.');
  }
  return document;
}

async function readManifest(manifestPath) {
  await assertRegularFile(manifestPath, 'Backup manifest');
  const document = JSON.parse(await readFile(manifestPath, 'utf8'));
  return parseManifestDocument(document, manifestPath);
}

export async function backupSqliteDatabase(options) {
  const { dataset, sourcePath, outputDirectory, now = () => new Date(), keepCount } = options ?? {};
  assertDataset(dataset);
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    throw new Error('sourcePath is required.');
  }
  if (typeof outputDirectory !== 'string' || outputDirectory.length === 0) {
    throw new Error('outputDirectory is required.');
  }
  await assertRegularFile(sourcePath, 'SQLite source');
  const sourceInspection = inspectSqliteDatabase(sourcePath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);

  const createdAt = now();
  const stamp = timestampSlug(createdAt);
  const backupFile = `${dataset}-${stamp}.sqlite`;
  const manifestFile = `${dataset}-${stamp}.manifest.json`;
  const backupPath = join(outputDirectory, backupFile);
  const manifestPath = join(outputDirectory, manifestFile);
  if ((await exists(backupPath)) || (await exists(manifestPath))) {
    throw new Error(`Backup set already exists for ${dataset} at ${createdAt.toISOString()}.`);
  }

  const partialBackup = join(
    outputDirectory,
    `.${backupFile}.${process.pid}.${randomUUID()}.partial`,
  );
  const partialManifest = join(
    outputDirectory,
    `.${manifestFile}.${process.pid}.${randomUUID()}.partial`,
  );
  const sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(sourceDatabase, partialBackup);
  } finally {
    sourceDatabase.close();
  }

  try {
    await chmod(partialBackup, 0o600);
    const backupInspection = await inspectTransientSqliteDatabase(partialBackup);
    const backupDetails = await stat(partialBackup);
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      dataset,
      createdAt: createdAt.toISOString(),
      sourceFile: basename(sourcePath),
      backupFile,
      sizeBytes: backupDetails.size,
      sha256: await sha256(partialBackup),
      sqlite: backupInspection,
      sourceSqlite: sourceInspection,
    };
    await writeFile(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(partialBackup, backupPath);
    await rename(partialManifest, manifestPath);

    if (keepCount !== undefined) {
      await pruneBackupSets({ dataset, outputDirectory, keepCount });
    }
    return { backupPath, manifestPath, manifest };
  } catch (error) {
    await rm(partialBackup, { force: true });
    await removeSqliteSidecars(partialBackup);
    await rm(partialManifest, { force: true });
    await rm(backupPath, { force: true });
    await removeSqliteSidecars(backupPath);
    await rm(manifestPath, { force: true });
    throw error;
  }
}

export async function verifySqliteBackup(manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
    throw new Error('manifestPath is required.');
  }
  const manifest = await readManifest(manifestPath);
  const backupPath = join(dirname(manifestPath), manifest.backupFile);
  const details = await assertRegularFile(backupPath, 'SQLite backup');
  if (details.size !== manifest.sizeBytes) {
    throw new Error(
      `SQLite backup size mismatch: expected ${manifest.sizeBytes}, observed ${details.size}.`,
    );
  }
  const observedDigest = await sha256(backupPath);
  if (observedDigest !== manifest.sha256) {
    throw new Error(
      `SQLite backup SHA-256 mismatch: expected ${manifest.sha256}, observed ${observedDigest}.`,
    );
  }
  const inspection = await inspectTransientSqliteDatabase(backupPath);
  return {
    dataset: manifest.dataset,
    backupPath,
    manifestPath,
    quickCheck: inspection.quickCheck,
    inspection,
    manifest,
  };
}

async function prepareRestoreTarget(targetPath, replace) {
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const targetExists = await exists(targetPath);
  if (!targetExists) return false;

  await assertRegularFile(targetPath, 'Restore target');
  if (!replace) {
    throw new Error(
      'Restore target already exists; pass replace: true after stopping the service.',
    );
  }
  return true;
}

function temporaryRestorePath(targetPath) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.restore-partial`,
  );
}

async function prepareTemporaryRestore(backupPath, targetPath, fileOperations) {
  const temporaryTarget = temporaryRestorePath(targetPath);
  try {
    await fileOperations.copyFile(backupPath, temporaryTarget);
    await fileOperations.chmod(temporaryTarget, 0o600);
    await inspectTransientSqliteDatabase(temporaryTarget, fileOperations);
    return temporaryTarget;
  } catch (error) {
    await fileOperations.rm(temporaryTarget, { force: true });
    await removeSqliteSidecars(temporaryTarget, fileOperations);
    throw error;
  }
}

async function moveToRollback(original, stamp, rollbackState, fileOperations) {
  if (!(await exists(original))) return;
  const rollback = `${original}.pre-restore-${stamp}`;
  await fileOperations.rename(original, rollback);
  rollbackState.moves.push({ original, rollback });
  rollbackState.files.push(rollback);
}

async function stageRollbackFiles(targetPath, targetExists, stamp, rollbackState, fileOperations) {
  if (targetExists) {
    await moveToRollback(targetPath, stamp, rollbackState, fileOperations);
  }
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    await moveToRollback(`${targetPath}${suffix}`, stamp, rollbackState, fileOperations);
  }
}

async function recoverOriginalFiles({
  temporaryTarget,
  targetPath,
  targetInstalled,
  rollbackMoves,
  fileOperations,
}) {
  await fileOperations.rm(temporaryTarget, { force: true });
  await removeSqliteSidecars(temporaryTarget, fileOperations);
  if (targetInstalled) {
    await fileOperations.rm(targetPath, { force: true });
    await removeSqliteSidecars(targetPath, fileOperations);
  }
  for (const move of [...rollbackMoves].reverse()) {
    if (await exists(move.original)) {
      await fileOperations.rm(move.original, { force: true });
    }
    if (await exists(move.rollback)) {
      await fileOperations.rename(move.rollback, move.original);
    }
  }
}

export async function restoreSqliteBackup(options) {
  const {
    manifestPath,
    targetPath,
    replace = false,
    now = () => new Date(),
    fileOperations = DEFAULT_RESTORE_FILE_OPERATIONS,
  } = options ?? {};
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('targetPath is required.');
  }

  const verified = await verifySqliteBackup(manifestPath);
  if (resolve(targetPath) === resolve(verified.backupPath)) {
    throw new Error('Refusing to restore a backup over itself.');
  }

  const targetExists = await prepareRestoreTarget(targetPath, replace);
  const temporaryTarget = await prepareTemporaryRestore(
    verified.backupPath,
    targetPath,
    fileOperations,
  );
  const rollbackState = { files: [], moves: [] };
  let targetInstalled = false;

  try {
    await stageRollbackFiles(
      targetPath,
      targetExists,
      timestampSlug(now()),
      rollbackState,
      fileOperations,
    );
    await fileOperations.rename(temporaryTarget, targetPath);
    targetInstalled = true;
    await fileOperations.chmod(targetPath, 0o600);
    const inspection = await inspectTransientSqliteDatabase(targetPath, fileOperations);
    return {
      dataset: verified.dataset,
      targetPath,
      rollbackFiles: rollbackState.files,
      quickCheck: inspection.quickCheck,
      inspection,
    };
  } catch (error) {
    await recoverOriginalFiles({
      temporaryTarget,
      targetPath,
      targetInstalled,
      rollbackMoves: rollbackState.moves,
      fileOperations,
    });
    throw error;
  }
}

export async function pruneBackupSets(options) {
  const { dataset, outputDirectory, keepCount } = options ?? {};
  assertDataset(dataset);
  if (!Number.isSafeInteger(keepCount) || keepCount < 1) {
    throw new Error('keepCount must be a positive integer.');
  }
  const names = await readdir(outputDirectory);
  const sets = [];
  for (const name of names) {
    if (!name.startsWith(`${dataset}-`) || !name.endsWith('.manifest.json')) continue;
    const manifestPath = join(outputDirectory, name);
    const manifest = await readManifest(manifestPath);
    if (manifest.dataset !== dataset) continue;
    sets.push({
      createdAt: manifest.createdAt,
      manifest: manifestPath,
      backup: join(outputDirectory, manifest.backupFile),
    });
  }
  sets.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const kept = sets.slice(0, keepCount);
  const removed = sets.slice(keepCount);
  for (const set of removed) {
    await rm(set.backup, { force: true });
    await removeSqliteSidecars(set.backup);
    await rm(set.manifest, { force: true });
  }
  return { kept, removed };
}
