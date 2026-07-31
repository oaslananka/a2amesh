import {
  registeredAgentArray,
  schemaRef,
  stringArraySchema,
  timestampSchema,
} from './openApiHelpers.js';

export const registryOpenApiSchemas = {
  AgentCard: {
    type: 'object',
    additionalProperties: true,
    required: ['protocolVersion', 'name', 'description', 'url', 'version'],
    properties: {
      protocolVersion: {
        type: 'string',
        enum: ['0.3', '1.0', '1.2'],
      },
      name: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      url: {
        type: 'string',
        format: 'uri',
      },
      iconUrl: {
        type: 'string',
        format: 'uri',
      },
      documentationUrl: {
        type: 'string',
        format: 'uri',
      },
      provider: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'url'],
        properties: {
          name: {
            type: 'string',
          },
          url: {
            type: 'string',
            format: 'uri',
          },
        },
      },
      modelHints: stringArraySchema,
      transport: schemaRef('AgentTransport'),
      version: {
        type: 'string',
      },
      capabilities: {
        type: 'object',
        additionalProperties: true,
      },
      supportedInterfaces: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      protocolBinding: {
        type: 'string',
      },
      defaultInputModes: stringArraySchema,
      defaultOutputModes: stringArraySchema,
      skills: {
        type: 'array',
        items: schemaRef('AgentSkill'),
      },
      securitySchemes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      security: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
      },
      signatures: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      signedAt: timestampSchema,
      extensions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  },
  AgentSkill: {
    type: 'object',
    additionalProperties: true,
    required: ['id', 'name', 'description'],
    properties: {
      id: {
        type: 'string',
      },
      name: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      tags: stringArraySchema,
      examples: stringArraySchema,
      inputModes: stringArraySchema,
      outputModes: stringArraySchema,
    },
  },
  AgentStatus: {
    type: 'string',
    enum: ['healthy', 'unhealthy', 'unknown'],
  },
  AgentTransport: {
    type: 'string',
    enum: ['http', 'sse', 'ws', 'grpc'],
  },
  AuthErrorResponse: {
    type: 'object',
    additionalProperties: true,
    required: ['type', 'title', 'status', 'detail'],
    properties: {
      type: {
        type: 'string',
        enum: ['https://a2a-protocol.org/errors/registry/unauthorized'],
      },
      title: {
        type: 'string',
        enum: ['Unauthorized'],
      },
      status: {
        type: 'integer',
        enum: [401],
      },
      detail: {
        type: 'string',
      },
      reason: {
        type: 'string',
      },
    },
  },
  ErrorResponse: {
    type: 'object',
    additionalProperties: true,
    required: ['type', 'title', 'status', 'detail'],
    properties: {
      type: {
        type: 'string',
        pattern: '^https://a2a-protocol[.]org/errors/registry/',
      },
      title: {
        type: 'string',
      },
      status: {
        type: 'integer',
        minimum: 400,
        maximum: 599,
      },
      detail: {
        type: 'string',
      },
    },
  },
  RateLimitErrorResponse: {
    type: 'object',
    additionalProperties: true,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        additionalProperties: true,
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            enum: ['Too Many Requests'],
          },
        },
      },
    },
  },
  RegistryOperatorContext: {
    type: 'object',
    additionalProperties: false,
    required: ['accessMode', 'authMethod', 'tenantId', 'visibilityScope', 'healthStaleAfterMs'],
    properties: {
      accessMode: {
        type: 'string',
        enum: ['authenticated', 'readonly-public'],
      },
      authMethod: {
        type: 'string',
        enum: ['anonymous', 'apiKey', 'bearer', 'oidc'],
      },
      tenantId: {
        type: ['string', 'null'],
      },
      visibilityScope: {
        type: 'string',
        enum: ['all', 'tenant-and-public', 'public-and-unassigned', 'public-only'],
      },
      healthStaleAfterMs: {
        type: 'integer',
        minimum: 1,
      },
    },
  },
  AgentCardVerification: {
    type: 'object',
    additionalProperties: false,
    required: ['required', 'valid', 'state', 'verifiedAt'],
    properties: {
      required: { type: 'boolean' },
      valid: { type: 'boolean' },
      state: {
        type: 'string',
        enum: ['trusted', 'unverified', 'rejected'],
      },
      verifiedAt: timestampSchema,
      keyId: { type: 'string' },
      tenantId: { type: 'string' },
      failureReason: { type: 'string' },
    },
  },
  RegisterAgentRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['agentUrl', 'agentCard'],
    properties: {
      agentUrl: {
        type: 'string',
        format: 'uri',
      },
      agentCard: schemaRef('AgentCard'),
      tenantId: {
        type: 'string',
      },
      isPublic: {
        type: 'boolean',
      },
    },
  },
  RegisteredAgent: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'url', 'card', 'status', 'tags', 'skills', 'registeredAt'],
    properties: {
      id: {
        type: 'string',
      },
      url: {
        type: 'string',
        format: 'uri',
      },
      card: schemaRef('AgentCard'),
      status: schemaRef('AgentStatus'),
      tags: stringArraySchema,
      skills: stringArraySchema,
      registeredAt: timestampSchema,
      lastHeartbeatAt: timestampSchema,
      consecutiveFailures: {
        type: 'integer',
        minimum: 0,
      },
      lastSuccessAt: timestampSchema,
      tenantId: {
        type: 'string',
      },
      isPublic: {
        type: 'boolean',
      },
      verification: schemaRef('AgentCardVerification'),
    },
  },
  RegistryEvent: {
    oneOf: [schemaRef('RegistryAgentEvent'), schemaRef('RegistryDeletedEvent')],
  },
  RegistryAgentEvent: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'agent'],
    properties: {
      type: {
        type: 'string',
        enum: ['registered', 'heartbeat', 'imported', 'updated'],
      },
      agent: schemaRef('RegisteredAgent'),
    },
  },
  RegistryDeletedEvent: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'id'],
    properties: {
      type: {
        type: 'string',
        enum: ['deleted'],
      },
      id: {
        type: 'string',
      },
    },
  },
  RegistryExportDocument: {
    type: 'object',
    additionalProperties: false,
    required: ['$schema', 'schemaVersion', 'exportedAt', 'agents', 'metadata'],
    properties: {
      $schema: {
        type: 'string',
        const: 'https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json',
      },
      schemaVersion: {
        type: 'string',
        const: '1',
      },
      exportedAt: timestampSchema,
      agents: registeredAgentArray,
      metadata: schemaRef('RegistryExportMetadata'),
    },
  },
  RegistryExportMetadata: {
    type: 'object',
    additionalProperties: true,
    required: ['source', 'agentCount', 'tenants', 'publicAgents'],
    properties: {
      source: {
        type: 'string',
        const: 'a2amesh-registry',
      },
      agentCount: {
        type: 'integer',
        minimum: 0,
      },
      tenants: stringArraySchema,
      publicAgents: {
        type: 'integer',
        minimum: 0,
      },
    },
  },
  RegistryHealth: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'agents', 'healthyAgents'],
    properties: {
      status: {
        type: 'string',
        enum: ['ok'],
      },
      agents: {
        type: 'integer',
        minimum: 0,
      },
      healthyAgents: {
        type: 'integer',
        minimum: 0,
      },
    },
  },
  RegistryImportResult: {
    type: 'object',
    additionalProperties: false,
    required: ['imported', 'updated', 'skipped', 'total'],
    properties: {
      imported: {
        type: 'integer',
        minimum: 0,
      },
      updated: {
        type: 'integer',
        minimum: 0,
      },
      skipped: {
        type: 'integer',
        minimum: 0,
      },
      total: {
        type: 'integer',
        minimum: 0,
      },
    },
  },
  RegistryMetricsSummary: {
    type: 'object',
    additionalProperties: false,
    required: [
      'registrations',
      'searches',
      'heartbeats',
      'agentCount',
      'healthyAgents',
      'unhealthyAgents',
      'unknownAgents',
      'activeTenants',
      'publicAgents',
    ],
    properties: {
      registrations: {
        type: 'integer',
        minimum: 0,
      },
      searches: {
        type: 'integer',
        minimum: 0,
      },
      heartbeats: {
        type: 'integer',
        minimum: 0,
      },
      agentCount: {
        type: 'integer',
        minimum: 0,
      },
      healthyAgents: {
        type: 'integer',
        minimum: 0,
      },
      unhealthyAgents: {
        type: 'integer',
        minimum: 0,
      },
      unknownAgents: {
        type: 'integer',
        minimum: 0,
      },
      activeTenants: {
        type: 'integer',
        minimum: 0,
      },
      publicAgents: {
        type: 'integer',
        minimum: 0,
      },
    },
  },
  RegistryTaskEvent: {
    type: 'object',
    additionalProperties: false,
    required: [
      'taskId',
      'agentId',
      'agentName',
      'agentUrl',
      'status',
      'updatedAt',
      'historyCount',
      'artifactCount',
      'task',
    ],
    properties: {
      taskId: {
        type: 'string',
      },
      agentId: {
        type: 'string',
      },
      agentName: {
        type: 'string',
      },
      agentUrl: {
        type: 'string',
        format: 'uri',
      },
      status: {
        type: 'string',
      },
      updatedAt: timestampSchema,
      contextId: {
        type: 'string',
      },
      summary: {
        type: 'string',
      },
      historyCount: {
        type: 'integer',
        minimum: 0,
      },
      artifactCount: {
        type: 'integer',
        minimum: 0,
      },
      task: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
  TrustLogEntry: {
    type: 'object',
    additionalProperties: false,
    required: ['sequence', 'cardHash', 'keyId', 'algorithm', 'agentUrl', 'timestamp', 'entryHash'],
    properties: {
      sequence: {
        type: 'integer',
        minimum: 0,
      },
      cardHash: {
        type: 'string',
      },
      keyId: {
        type: 'string',
      },
      algorithm: {
        type: 'string',
      },
      agentUrl: {
        type: 'string',
        format: 'uri',
      },
      tenantId: {
        type: 'string',
      },
      timestamp: timestampSchema,
      entryHash: {
        type: 'string',
      },
    },
  },
  ValidationErrorResponse: {
    type: 'object',
    additionalProperties: true,
    required: ['type', 'title', 'status', 'detail'],
    properties: {
      type: {
        type: 'string',
        enum: ['https://a2a-protocol.org/errors/registry/bad-request'],
      },
      title: {
        type: 'string',
        enum: ['Bad Request'],
      },
      status: {
        type: 'integer',
        enum: [400],
      },
      detail: {
        type: 'string',
      },
      issues: {
        type: 'array',
        items: schemaRef('ValidationIssue'),
      },
    },
  },
  ValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'message'],
    properties: {
      path: {
        type: 'string',
      },
      message: {
        type: 'string',
      },
    },
  },
} as const;
