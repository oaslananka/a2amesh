/**
 * @file task.ts
 * Core task, message and artifact types used by the A2A runtime.
 */

import type { AuthScheme } from './auth.js';
import type { A2AExtension } from './extensions.js';

interface TextPart {
  type: 'text';
  text: string;
}

interface FilePart {
  type: 'file';
  file: {
    name?: string;
    mimeType: string;
    bytes?: string;
    uri?: string;
  };
}

interface DataPart {
  type: 'data';
  data: Record<string, unknown>;
}

type Part = TextPart | FilePart | DataPart;

export type MessageRole = 'ROLE_USER' | 'ROLE_AGENT';
export type LegacyMessageRole = 'user' | 'agent';
type MessageRoleInput = MessageRole | LegacyMessageRole;

export interface Message {
  kind?: 'message';
  role: MessageRoleInput;
  parts: Part[];
  messageId: string;
  timestamp: string;
  contextId?: string;
}

export interface PushNotificationConfig {
  id?: string;
  url: string;
  token?: string;
  authentication?: AuthScheme;
  metadata?: Record<string, unknown>;
}

export interface TaskPushNotificationConfig {
  taskId: string;
  pushNotificationConfig: PushNotificationConfig;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  index: number;
  lastChunk?: boolean;
}

export interface ExtensibleArtifact extends Artifact {
  extensions?: string[];
  metadata?: Record<string, unknown>;
  /** The principal (user or service account) that owns this task */
  principalId?: string;
  /** The tenant or namespace this task belongs to */
  tenantId?: string;
}

export interface TaskStatus {
  state: TaskState;
  timestamp: string;
  message?: string;
}

export type TaskState =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'WORKING'
  | 'INPUT_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'WAITING_ON_EXTERNAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'REJECTED';
type LegacyTaskState =
  | 'submitted'
  | 'queued'
  | 'working'
  | 'input-required'
  | 'input_required'
  | 'auth-required'
  | 'auth_required'
  | 'waiting_on_external'
  | 'waiting-on-external'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected';
type OfficialTaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_QUEUED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_WAITING_ON_EXTERNAL'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED';
export type TaskStateInput = TaskState | LegacyTaskState | OfficialTaskState;
export type TerminalTaskState = 'COMPLETED' | 'FAILED' | 'CANCELED' | 'REJECTED';

export interface Task {
  kind?: 'task';
  id: string;
  sessionId?: string;
  contextId?: string;
  principalId?: string;
  tenantId?: string;
  status: TaskStatus;
  history: Message[];
  artifacts?: ExtensibleArtifact[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface TaskListParams {
  contextId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskListResult {
  tasks: Task[];
  total: number;
}

export interface TaskCounts {
  total: number;
  active: number;
  completed: number;
  failed: number;
  canceled: number;
  rejected: number;
  submitted: number;
  queued: number;
  inputRequired: number;
  authRequired: number;
  waitingOnExternal: number;
  working: number;
}

interface MessageRequestConfiguration {
  blocking?: boolean;
  returnImmediately?: boolean;
  return_immediately?: boolean;
  acceptedOutputModes?: string[];
  historyLength?: number;
  history_length?: number;
  pushNotificationConfig?: PushNotificationConfig;
  taskPushNotificationConfig?: PushNotificationConfig;
  task_push_notification_config?: PushNotificationConfig;
  extensions?: A2AExtension[];
}

export interface MessageSendParams {
  message: Message;
  taskId?: string;
  sessionId?: string;
  contextId?: string;
  configuration?: MessageRequestConfiguration;
}

export interface A2AHealthResponse {
  status: 'healthy';
  version: string;
  protocol: 'A2A/1.0';
  uptime: number;
  tasks: Pick<TaskCounts, 'active' | 'completed' | 'failed' | 'total'>;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
  };
}
