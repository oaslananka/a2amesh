/**
 * @file schema-validator.ts
 * Zod-based validation for A2A messages and configurations.
 */

import type { z } from 'zod';
import { JsonRpcError, ErrorCodes, type JsonRpcRequest } from '../types/jsonrpc.js';
import type { MessageSendParams, TaskListParams } from '../types/task.js';
import {
  JsonRpcRequestSchema,
  MessageSendParamsSchema,
  TaskListParamsSchema,
} from '../schemas/public.js';

export {
  A2AExtensionSchema,
  AuthSchemeSchema,
  IsoDateTimeSchema,
  JsonRpcRequestSchema,
  MessageRequestConfigurationSchema,
  MessageSchema,
  MessageSendParamsSchema,
  PartSchema,
  PushNotificationConfigSchema,
  TaskListParamsSchema,
  TaskPushNotificationConfigSchema,
} from '../schemas/public.js';

/**
 * Validates a payload against a zod schema.
 * Throws a JsonRpcError if validation fails.
 * @param schema The zod schema to validate against.
 * @param data The payload to validate.
 * @returns The validated data.
 */
export function validateRequest<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new JsonRpcError(
      ErrorCodes.InvalidParams,
      'Invalid parameters',
      validationIssueMetadata(result.error.issues),
    );
  }
  return result.data;
}

export function validateJsonRpcRequest(data: unknown): JsonRpcRequest {
  const result = JsonRpcRequestSchema.safeParse(data);
  if (!result.success) {
    throw new JsonRpcError(
      ErrorCodes.InvalidRequest,
      'Invalid JSON-RPC request',
      validationIssueMetadata(result.error.issues),
    );
  }
  return result.data as JsonRpcRequest;
}

export function validateMessageSendParams(data: unknown): MessageSendParams {
  return validateRequest(MessageSendParamsSchema, data) as MessageSendParams;
}

export function validateTaskListParams(data: unknown): TaskListParams {
  return validateRequest(TaskListParamsSchema, data) as TaskListParams;
}

const MAX_VALIDATION_ISSUES = 8;
const MAX_VALIDATION_DETAILS_LENGTH = 1024;
const MAX_VALIDATION_MESSAGE_LENGTH = 160;
const MAX_VALIDATION_PATH_SEGMENTS = 8;
const MAX_VALIDATION_PATH_SEGMENT_LENGTH = 64;

interface ValidationIssueLike {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}

function validationIssueMetadata(issues: readonly ValidationIssueLike[]): Record<string, string> {
  const summarizedIssues = issues.slice(0, MAX_VALIDATION_ISSUES).map((issue) => ({
    code: issue.code,
    path: issue.path
      .slice(0, MAX_VALIDATION_PATH_SEGMENTS)
      .map((segment) => String(segment).slice(0, MAX_VALIDATION_PATH_SEGMENT_LENGTH)),
    message: issue.message.slice(0, MAX_VALIDATION_MESSAGE_LENGTH),
  }));
  const serialized = JSON.stringify(summarizedIssues);
  const details = serialized.slice(0, MAX_VALIDATION_DETAILS_LENGTH);
  const truncated = issues.length > summarizedIssues.length || serialized.length > details.length;

  return {
    issueCount: String(issues.length),
    details,
    ...(truncated ? { truncated: 'true' } : {}),
  };
}
