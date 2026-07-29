import type { PushNotificationConfig } from '../types/task.js';
import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import {
  DEFAULT_PUSH_NOTIFICATION_CONFIG_ID,
  parsePushNotification,
  parsePushNotificationConfigs,
  pushNotificationConfigId,
  serializePushNotificationConfigs,
  type PushNotificationRow,
} from './SqliteTaskStorageRecords.js';
import { getTaskFromSqlite } from './SqliteTaskStorageTasks.js';

export function setPushNotificationInSqlite(
  db: SqliteDatabase,
  taskId: string,
  config: PushNotificationConfig,
): PushNotificationConfig | undefined {
  return setPushNotificationConfigInSqlite(db, taskId, pushNotificationConfigId(config), config);
}

export function setPushNotificationConfigInSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
  config: PushNotificationConfig,
): PushNotificationConfig | undefined {
  if (!getTaskFromSqlite(db, taskId)) {
    return undefined;
  }

  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  const storedConfig = structuredClone(config);
  configs.set(configId, storedConfig);

  db.prepare(
    'INSERT INTO push_notifications (task_id, config_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET config_json = excluded.config_json',
  ).run(taskId, serializePushNotificationConfigs(configs));

  return structuredClone(storedConfig);
}

export function getPushNotificationFromSqlite(
  db: SqliteDatabase,
  taskId: string,
): PushNotificationConfig | undefined {
  return parsePushNotification(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
}

export function listPushNotificationsFromSqlite(
  db: SqliteDatabase,
  taskId: string,
): PushNotificationConfig[] {
  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  return Array.from(configs.values(), (config) => structuredClone(config));
}

export function getPushNotificationConfigFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
): PushNotificationConfig | undefined {
  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  const config = configs.get(configId);
  return config ? structuredClone(config) : undefined;
}

export function removePushNotificationConfigFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
): boolean {
  const row = db
    .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
    .get(taskId);
  const configs = parsePushNotificationConfigs(row);
  const removed = configs.delete(configId);
  if (!removed) {
    return false;
  }

  if (configs.size === 0) {
    db.prepare('DELETE FROM push_notifications WHERE task_id = ?').run(taskId);
  } else {
    db.prepare(
      'INSERT INTO push_notifications (task_id, config_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET config_json = excluded.config_json',
    ).run(taskId, serializePushNotificationConfigs(configs));
  }
  return true;
}

export function removePushNotificationFromSqlite(db: SqliteDatabase, taskId: string): boolean {
  return removePushNotificationConfigFromSqlite(db, taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
}
