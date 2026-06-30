import { z } from 'zod';
import { normalizeMessageRole } from '../utils/compat.js';

const MetadataSchema = z.record(z.string(), z.unknown());
const SecurityRequirementSchema = z.record(z.string(), z.array(z.string()));

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const AuthSchemeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('apiKey'),
    id: z.string(),
    in: z.enum(['header', 'query']),
    name: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('http'),
    id: z.string(),
    scheme: z.literal('bearer'),
    bearerFormat: z.string().optional(),
    jwksUri: z.string().url().optional(),
    audience: z.union([z.string(), z.array(z.string())]).optional(),
    issuer: z.string().optional(),
    algorithms: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('openIdConnect'),
    id: z.string(),
    openIdConnectUrl: z.string().url(),
    audience: z.union([z.string(), z.array(z.string())]).optional(),
    issuer: z.string().optional(),
    jwksUri: z.string().url().optional(),
    algorithms: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
]);

export const A2AExtensionSchema = z.object({
  uri: z.string().url(),
  version: z.string().optional(),
  required: z.boolean().optional(),
});

export const AgentCardSignatureSchema = z.object({
  algorithm: z.enum(['ES256', 'RS256', 'EdDSA']),
  keyId: z.string(),
  jws: z.string(),
});

export const SupportedInterfaceSchema = z.object({
  url: z.string().url(),
  protocolBinding: z.enum(['HTTP+JSON', 'gRPC', 'WebSocket']),
  protocolVersion: z.enum(['0.3', '1.0', '1.2']),
});

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  stateTransitionHistory: z.boolean().optional(),
  extendedAgentCard: z.boolean().optional(),
  mcpCompatible: z.boolean().optional(),
  backgroundJobs: z.boolean().optional(),
});

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
});

export const AgentCardProviderSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

export const AgentCardV03Schema = z.object({
  protocolVersion: z.literal('0.3'),
  name: z.string(),
  description: z.string(),
  url: z.string().url(),
  iconUrl: z.string().url().optional(),
  provider: AgentCardProviderSchema.optional(),
  version: z.string(),
  capabilities: AgentCapabilitiesSchema.optional(),
  skills: z.array(AgentSkillSchema).optional(),
  defaultInputMode: z.string().optional(),
  defaultOutputMode: z.string().optional(),
  authentication: z.array(AuthSchemeSchema).optional(),
  supportsAuthenticatedExtendedCard: z.boolean().optional(),
});

export const AgentCardSchema = z.object({
  protocolVersion: z.enum(['1.0', '1.2']),
  name: z.string(),
  description: z.string(),
  url: z.string().url(),
  iconUrl: z.string().url().optional(),
  documentationUrl: z.string().url().optional(),
  provider: AgentCardProviderSchema.optional(),
  modelHints: z.array(z.string()).optional(),
  transport: z.enum(['http', 'sse', 'ws', 'grpc']).optional(),
  version: z.string(),
  capabilities: AgentCapabilitiesSchema.optional(),
  supportedInterfaces: z.array(SupportedInterfaceSchema).optional(),
  protocolBinding: z.string().optional(),
  defaultInputModes: z.array(z.string()).optional(),
  defaultOutputModes: z.array(z.string()).optional(),
  skills: z.array(AgentSkillSchema).optional(),
  securitySchemes: z.array(AuthSchemeSchema).optional(),
  security: z.array(SecurityRequirementSchema).optional(),
  signatures: z.array(AgentCardSignatureSchema).optional(),
  signedAt: IsoDateTimeSchema.optional(),
  extensions: z.array(A2AExtensionSchema).optional(),
});

export const AnyAgentCardSchema = z.union([AgentCardSchema, AgentCardV03Schema]);

export const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const FilePartSchema = z.object({
  type: z.literal('file'),
  file: z.object({
    name: z.string().optional(),
    mimeType: z.string(),
    bytes: z.string().optional(),
    uri: z.string().optional(),
  }),
});

export const DataPartSchema = z.object({
  type: z.literal('data'),
  data: MetadataSchema,
});

export const PartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);

export const MessageRoleSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return normalizeMessageRole(value);
    } catch {
      return value;
    }
  },
  z.enum(['ROLE_USER', 'ROLE_AGENT']),
);

export const MessageSchema = z.object({
  kind: z.literal('message').optional(),
  role: MessageRoleSchema,
  parts: z.array(PartSchema),
  messageId: z.string(),
  timestamp: IsoDateTimeSchema,
  contextId: z.string().optional(),
});

export const PushNotificationConfigSchema = z.object({
  id: z.string().optional(),
  url: z.string().url(),
  token: z.string().optional(),
  authentication: AuthSchemeSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const TaskPushNotificationConfigSchema = z.object({
  taskId: z.string(),
  pushNotificationConfig: PushNotificationConfigSchema,
});

export const MessageRequestConfigurationSchema = z.object({
  blocking: z.boolean().optional(),
  returnImmediately: z.boolean().optional(),
  return_immediately: z.boolean().optional(),
  acceptedOutputModes: z.array(z.string()).optional(),
  historyLength: z.number().int().min(0).optional(),
  history_length: z.number().int().min(0).optional(),
  pushNotificationConfig: PushNotificationConfigSchema.optional(),
  taskPushNotificationConfig: PushNotificationConfigSchema.optional(),
  task_push_notification_config: PushNotificationConfigSchema.optional(),
  extensions: z.array(A2AExtensionSchema).optional(),
});

export const MessageSendParamsSchema = z.object({
  message: MessageSchema,
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  contextId: z.string().optional(),
  configuration: MessageRequestConfigurationSchema.optional(),
});

export const ArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(PartSchema),
  index: z.number().int().min(0),
  lastChunk: z.boolean().optional(),
});

export const ExtensibleArtifactSchema = ArtifactSchema.extend({
  extensions: z.array(z.string()).optional(),
  metadata: MetadataSchema.optional(),
  principalId: z.string().optional(),
  tenantId: z.string().optional(),
});

export const TaskStateSchema = z.enum([
  'SUBMITTED',
  'QUEUED',
  'WORKING',
  'INPUT_REQUIRED',
  'AUTH_REQUIRED',
  'WAITING_ON_EXTERNAL',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'REJECTED',
]);

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  timestamp: IsoDateTimeSchema,
  message: z.string().optional(),
});

export const TaskSchema = z.object({
  kind: z.literal('task').optional(),
  id: z.string(),
  sessionId: z.string().optional(),
  contextId: z.string().optional(),
  principalId: z.string().optional(),
  tenantId: z.string().optional(),
  status: TaskStatusSchema,
  history: z.array(MessageSchema),
  artifacts: z.array(ExtensibleArtifactSchema).optional(),
  metadata: MetadataSchema.optional(),
  extensions: z.array(z.string()).optional(),
});

export const TaskListParamsSchema = z.object({
  contextId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.union([MetadataSchema, z.array(z.unknown())]).optional(),
  id: JsonRpcIdSchema.optional(),
});

export const JsonRpcErrorInfoSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcIdSchema,
  result: z.unknown(),
});

export const JsonRpcFailureResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcIdSchema,
  error: JsonRpcErrorInfoSchema,
});

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcFailureResponseSchema,
]);

export const JsonRpcEnvelopeSchema = z.union([JsonRpcRequestSchema, JsonRpcResponseSchema]);

export const RegistryAgentStatusSchema = z.enum(['healthy', 'unhealthy', 'unknown']);

export const RegisteredAgentSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  card: AgentCardSchema,
  status: RegistryAgentStatusSchema,
  tags: z.array(z.string()),
  skills: z.array(z.string()),
  registeredAt: IsoDateTimeSchema,
  lastHeartbeatAt: IsoDateTimeSchema.optional(),
  consecutiveFailures: z.number().int().min(0).optional(),
  lastSuccessAt: IsoDateTimeSchema.optional(),
  tenantId: z.string().optional(),
  isPublic: z.boolean().optional(),
});

export const REGISTRY_EXPORT_SCHEMA_ID =
  'https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json';

export const RegistryExportMetadataSchema = z
  .object({
    source: z.literal('a2amesh-registry'),
    agentCount: z.number().int().min(0),
    tenants: z.array(z.string()),
    publicAgents: z.number().int().min(0),
  })
  .catchall(z.unknown());

export const RegistryExportDocumentSchema = z.object({
  $schema: z.literal(REGISTRY_EXPORT_SCHEMA_ID),
  schemaVersion: z.literal('1'),
  exportedAt: IsoDateTimeSchema,
  agents: z.array(RegisteredAgentSchema),
  metadata: RegistryExportMetadataSchema,
});

export type RegistryExportDocument = z.infer<typeof RegistryExportDocumentSchema>;

export const RegistryTaskEventSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  agentUrl: z.string().url(),
  status: TaskStateSchema,
  updatedAt: IsoDateTimeSchema,
  contextId: z.string().optional(),
  summary: z.string().optional(),
  historyCount: z.number().int().min(0),
  artifactCount: z.number().int().min(0),
  task: TaskSchema,
});

export interface PublicJsonSchemaSource {
  readonly typeSymbol: string;
  readonly schemaSymbol: string;
  readonly sourceFile: string;
}

export interface PublicJsonSchemaDefinition {
  readonly fileName: string;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly schema: z.ZodType;
  readonly source: PublicJsonSchemaSource;
}

export const publicJsonSchemaDefinitions = [
  {
    fileName: 'agent-card.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/agent-card.schema.json',
    title: 'A2A Mesh Agent Card',
    description: 'Agent2Agent Agent Card payloads accepted by A2A Mesh.',
    schema: AnyAgentCardSchema,
    source: {
      typeSymbol: 'AnyAgentCard',
      schemaSymbol: 'AnyAgentCardSchema',
      sourceFile: 'packages/runtime/src/types/agent-card.ts',
    },
  },
  {
    fileName: 'message.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/message.schema.json',
    title: 'A2A Mesh Message',
    description: 'Agent2Agent message payloads accepted by A2A Mesh.',
    schema: MessageSchema,
    source: {
      typeSymbol: 'Message',
      schemaSymbol: 'MessageSchema',
      sourceFile: 'packages/runtime/src/types/task.ts',
    },
  },
  {
    fileName: 'task.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/task.schema.json',
    title: 'A2A Mesh Task',
    description: 'Agent2Agent task payloads returned by A2A Mesh.',
    schema: TaskSchema,
    source: {
      typeSymbol: 'Task',
      schemaSymbol: 'TaskSchema',
      sourceFile: 'packages/runtime/src/types/task.ts',
    },
  },
  {
    fileName: 'artifact.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/artifact.schema.json',
    title: 'A2A Mesh Artifact',
    description: 'Agent2Agent artifact payloads returned on tasks.',
    schema: ExtensibleArtifactSchema,
    source: {
      typeSymbol: 'ExtensibleArtifact',
      schemaSymbol: 'ExtensibleArtifactSchema',
      sourceFile: 'packages/runtime/src/types/task.ts',
    },
  },
  {
    fileName: 'json-rpc.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/json-rpc.schema.json',
    title: 'A2A Mesh JSON-RPC Envelope',
    description: 'JSON-RPC 2.0 request and response envelopes used by A2A Mesh.',
    schema: JsonRpcEnvelopeSchema,
    source: {
      typeSymbol: 'JsonRpcRequest | JsonRpcResponse',
      schemaSymbol: 'JsonRpcEnvelopeSchema',
      sourceFile: 'packages/runtime/src/types/jsonrpc.ts',
    },
  },
  {
    fileName: 'registry-agent.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/registry-agent.schema.json',
    title: 'A2A Mesh Registry Agent',
    description: 'Registered agent payloads returned by the A2A Mesh registry.',
    schema: RegisteredAgentSchema,
    source: {
      typeSymbol: 'RegisteredAgent',
      schemaSymbol: 'RegisteredAgentSchema',
      sourceFile: 'packages/registry/src/storage/IAgentStorage.ts',
    },
  },
  {
    fileName: 'registry-export.schema.json',
    id: REGISTRY_EXPORT_SCHEMA_ID,
    title: 'A2A Mesh Registry Export',
    description:
      'Versioned registry export documents used to move A2A Mesh registry agent records between control planes.',
    schema: RegistryExportDocumentSchema,
    source: {
      typeSymbol: 'RegistryExportDocument',
      schemaSymbol: 'RegistryExportDocumentSchema',
      sourceFile: 'packages/runtime/src/schemas/public.ts',
    },
  },
  {
    fileName: 'registry-task-event.schema.json',
    id: 'https://oaslananka.github.io/a2amesh/schemas/registry-task-event.schema.json',
    title: 'A2A Mesh Registry Task Event',
    description: 'Task event payloads emitted by the A2A Mesh registry.',
    schema: RegistryTaskEventSchema,
    source: {
      typeSymbol: 'RegistryTaskEvent',
      schemaSymbol: 'RegistryTaskEventSchema',
      sourceFile: 'packages/registry/src/server/types.ts',
    },
  },
] as const satisfies readonly PublicJsonSchemaDefinition[];
