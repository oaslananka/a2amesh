// SPDX-FileCopyrightText: 2026 oaslananka
// SPDX-License-Identifier: Apache-2.0

export interface SqliteInspection {
  quickCheck: 'ok';
  pageCount: number;
  pageSize: number;
  journalMode: string;
  userVersion: number;
}

export interface SqliteBackupManifest {
  schemaVersion: 1;
  dataset: string;
  createdAt: string;
  sourceFile: string;
  backupFile: string;
  sizeBytes: number;
  sha256: string;
  sqlite: SqliteInspection;
  sourceSqlite: SqliteInspection;
}

export function backupSqliteDatabase(options: {
  dataset: string;
  sourcePath: string;
  outputDirectory: string;
  now?: () => Date;
  keepCount?: number;
}): Promise<{ backupPath: string; manifestPath: string; manifest: SqliteBackupManifest }>;
export function verifySqliteBackup(manifestPath: string): Promise<{
  dataset: string;
  backupPath: string;
  manifestPath: string;
  quickCheck: 'ok';
  inspection: SqliteInspection;
  manifest: SqliteBackupManifest;
}>;
export function restoreSqliteBackup(options: {
  manifestPath: string;
  targetPath: string;
  replace?: boolean;
  now?: () => Date;
  fileOperations?: {
    chmod(path: string, mode: number): Promise<void>;
    copyFile(source: string, destination: string): Promise<void>;
    rename(source: string, destination: string): Promise<void>;
    rm(path: string, options: { force: boolean }): Promise<void>;
  };
}): Promise<{
  dataset: string;
  targetPath: string;
  rollbackFiles: string[];
  quickCheck: 'ok';
  inspection: SqliteInspection;
}>;
export function pruneBackupSets(options: {
  dataset: string;
  outputDirectory: string;
  keepCount: number;
}): Promise<{
  kept: Array<{ createdAt: string; manifest: string; backup: string }>;
  removed: Array<{ createdAt: string; manifest: string; backup: string }>;
}>;
