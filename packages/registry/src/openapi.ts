type SchemaObject = Record<string, unknown>;

const jsonContent = (schema: SchemaObject) => ({
  'application/json': {
    schema,
  },
});

const textContent = (schema: SchemaObject) => ({
  'text/plain': {
    schema,
  },
});

const eventStreamContent = (description: string, payloadSchema: SchemaObject) => ({
  'text/event-stream': {
    schema: {
      type: 'string',
      description,
    },
    'x-a2a-event-payload-schema': payloadSchema,
  },
});

const schemaRef = (name: string): SchemaObject => ({
  $ref: `#/components/schemas/${name}`,
});

const responseRef = (name: string): SchemaObject => ({
  $ref: `#/components/responses/${name}`,
});

const parameterRef = (name: string): SchemaObject => ({
  $ref: `#/components/parameters/${name}`,
});

const jsonResponse = (description: string, schema: SchemaObject) => ({
  description,
  content: jsonContent(schema),
});

const problemContent = (schema: SchemaObject) => ({
  'application/problem+json': {
    schema,
  },
});

const problemResponse = (description: string, schema: SchemaObject) => ({
  description,
  content: problemContent(schema),
});

const stringArraySchema = {
  type: 'array',
  items: {
    type: 'string',
  },
};

const timestampSchema = {
  type: 'string',
  format: 'date-time',
};

const routeGroup = (
  prefix: string,
  meta: {
    register: { operationId: string; tags: string[]; summary: string };
  },
) => ({
  [`${prefix}/register`]: {
    post: {
      operationId: meta.register.operationId,
      tags: meta.register.tags,
      summary: meta.register.summary,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: jsonContent(schemaRef('RegisterAgentRequest')),
      },
      responses: {
        '201': jsonResponse('The registered agent record.', schemaRef('RegisteredAgent')),
        '400': responseRef('BadRequest'),
        ...authErrorResponses,
      },
    },
  },
});

const registeredAgentArray = {
  type: 'array',
  items: schemaRef('RegisteredAgent'),
};

const authErrorResponses = {
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '429': responseRef('RateLimited'),
};

const operationalErrorResponses = {
  '403': responseRef('Forbidden'),
  '429': responseRef('RateLimited'),
};

const mutationErrorResponses = {
  '400': responseRef('BadRequest'),
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '404': responseRef('NotFound'),
  '429': responseRef('RateLimited'),
};

const registryReadErrorResponses = {
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '404': responseRef('NotFound'),
  '429': responseRef('RateLimited'),
};

export const registryOpenApiDocument = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'A2A Mesh Registry API',
    version: '1.0.0',
    description:
      'Machine-readable contract for A2A Mesh registry discovery, control-plane, metrics, and event-stream endpoints.',
    license: {
      name: 'Apache-2.0',
      identifier: 'Apache-2.0',
    },
  },
  externalDocs: {
    description: 'A2A Mesh registry package documentation',
    url: 'https://github.com/oaslananka/a2amesh/tree/main/docs/packages/registry.md',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local registry server',
    },
  ],
  tags: [
    {
      name: 'Health',
      description: 'Registry health checks.',
    },
    {
      name: 'Metrics',
      description: 'Registry metrics for monitoring systems and dashboards.',
    },
    {
      name: 'Agents',
      description: 'Agent registration, discovery, lookup, heartbeat, and deletion.',
    },
    {
      name: 'Events',
      description: 'Server-sent event streams for registry and task changes.',
    },
    {
      name: 'Tasks',
      description: 'Recent task projections and task update streams.',
    },
    {
      name: 'Admin',
      description: 'Authenticated export and import control-plane operations.',
    },
  ],
  paths: {
    '/health': {
      get: {
        operationId: 'getRegistryHealth',
        tags: ['Health'],
        summary: 'Return registry health and agent counts.',
        responses: {
          '200': jsonResponse('Registry health summary.', schemaRef('RegistryHealth')),
          ...operationalErrorResponses,
        },
      },
    },
    '/metrics': {
      get: {
        operationId: 'getRegistryPrometheusMetrics',
        tags: ['Metrics'],
        summary: 'Return registry metrics in Prometheus text exposition format.',
        responses: {
          '200': {
            description: 'Prometheus metrics text.',
            content: textContent({
              type: 'string',
              examples: [
                '# HELP a2a_registry_registrations_total Total agent registrations.\n# TYPE a2a_registry_registrations_total counter\na2a_registry_registrations_total 1',
              ],
            }),
          },
          ...operationalErrorResponses,
        },
      },
    },
    '/metrics/summary': {
      get: {
        operationId: 'getRegistryMetricsSummary',
        tags: ['Metrics'],
        summary: 'Return registry metrics as JSON for UI dashboards and contract tests.',
        responses: {
          '200': jsonResponse('Registry metrics summary.', schemaRef('RegistryMetricsSummary')),
          ...operationalErrorResponses,
        },
      },
    },
    '/events': {
      get: {
        operationId: 'streamRegistryEvents',
        tags: ['Events'],
        summary: 'Stream authenticated registry update events.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'SSE stream containing registry_update events.',
            content: eventStreamContent(
              'Server-sent events whose data payload matches RegistryEvent.',
              schemaRef('RegistryEvent'),
            ),
          },
          ...authErrorResponses,
        },
      },
    },
    '/agents/stream': {
      get: {
        operationId: 'streamRegistryAgents',
        tags: ['Events', 'Agents'],
        summary: 'Stream authenticated normalized agent registry updates.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'SSE stream containing normalized RegisteredAgent updates.',
            content: eventStreamContent(
              'Server-sent events whose data payload matches RegisteredAgent.',
              schemaRef('RegisteredAgent'),
            ),
          },
          ...authErrorResponses,
        },
      },
    },
    '/agents': {
      get: {
        operationId: 'listRegistryAgents',
        tags: ['Agents'],
        summary: 'List registered agents.',
        description:
          'When public=true is supplied this endpoint returns public agents without control-plane authentication. Otherwise it requires the registry control-plane bearer token or JWT middleware.',
        security: [{ bearerAuth: [] }, {}],
        parameters: [parameterRef('PublicQuery')],
        responses: {
          '200': jsonResponse('Registered agents visible to the caller.', registeredAgentArray),
          ...authErrorResponses,
        },
      },
    },
    ...routeGroup('/agents', {
      register: {
        operationId: 'registerRegistryAgent',
        tags: ['Agents'],
        summary: 'Register or update an agent in the registry.',
      },
    }),
    ...routeGroup('/admin/agents', {
      register: {
        operationId: 'adminRegisterRegistryAgent',
        tags: ['Admin', 'Agents'],
        summary: 'Register or update an agent through the admin route alias.',
      },
    }),
    '/agents/search': {
      get: {
        operationId: 'searchRegistryAgents',
        tags: ['Agents'],
        summary: 'Search registered agents by capability or metadata.',
        description:
          'At least one filter is required. Public searches may omit authentication when public=true is supplied.',
        security: [{ bearerAuth: [] }, {}],
        parameters: [
          parameterRef('SkillQuery'),
          parameterRef('TagQuery'),
          parameterRef('NameQuery'),
          parameterRef('TransportQuery'),
          parameterRef('StatusQuery'),
          parameterRef('McpCompatibleQuery'),
          parameterRef('PublicQuery'),
        ],
        responses: {
          '200': jsonResponse('Matching registered agents.', registeredAgentArray),
          '400': responseRef('BadRequest'),
          ...authErrorResponses,
        },
      },
    },
    '/agents/{id}': {
      parameters: [parameterRef('AgentIdPath')],
      get: {
        operationId: 'getRegistryAgent',
        tags: ['Agents'],
        summary: 'Fetch a registered agent by id.',
        description:
          'Public agents can be fetched without authentication. Private agents require control-plane authentication and tenant access.',
        security: [{ bearerAuth: [] }, {}],
        responses: {
          '200': jsonResponse('Registered agent.', schemaRef('RegisteredAgent')),
          ...registryReadErrorResponses,
        },
      },
      delete: {
        operationId: 'deleteRegistryAgent',
        tags: ['Agents'],
        summary: 'Delete a registered agent by id.',
        security: [{ bearerAuth: [] }],
        responses: {
          '204': {
            description: 'Agent deleted.',
          },
          ...mutationErrorResponses,
        },
      },
    },
    '/agents/{id}/heartbeat': {
      parameters: [parameterRef('AgentIdPath')],
      post: {
        operationId: 'heartbeatRegistryAgent',
        tags: ['Agents'],
        summary: 'Mark a registered agent healthy and refresh heartbeat metadata.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': jsonResponse('Updated registered agent.', schemaRef('RegisteredAgent')),
          ...mutationErrorResponses,
        },
      },
    },
    '/admin/agents/{id}/heartbeat': {
      parameters: [parameterRef('AgentIdPath')],
      post: {
        operationId: 'adminHeartbeatRegistryAgent',
        tags: ['Admin', 'Agents'],
        summary: 'Mark a registered agent healthy through the admin route alias.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': jsonResponse('Updated registered agent.', schemaRef('RegisteredAgent')),
          ...mutationErrorResponses,
        },
      },
    },
    '/admin/agents/{id}': {
      parameters: [parameterRef('AgentIdPath')],
      delete: {
        operationId: 'adminDeleteRegistryAgent',
        tags: ['Admin', 'Agents'],
        summary: 'Delete a registered agent through the admin route alias.',
        security: [{ bearerAuth: [] }],
        responses: {
          '204': {
            description: 'Agent deleted.',
          },
          ...mutationErrorResponses,
        },
      },
    },
    '/admin/agents/export': {
      get: {
        operationId: 'exportRegistryAgents',
        tags: ['Admin'],
        summary: 'Export registered agents as a registry export document.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': jsonResponse('Registry export document.', schemaRef('RegistryExportDocument')),
          ...authErrorResponses,
        },
      },
    },
    '/admin/agents/import': {
      post: {
        operationId: 'importRegistryAgents',
        tags: ['Admin'],
        summary: 'Import registered agents from a registry export document.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: jsonContent(schemaRef('RegistryExportDocument')),
        },
        responses: {
          '200': jsonResponse('Registry import result.', schemaRef('RegistryImportResult')),
          '400': responseRef('ValidationError'),
          ...authErrorResponses,
        },
      },
    },
    '/tasks/recent': {
      get: {
        operationId: 'listRecentRegistryTasks',
        tags: ['Tasks'],
        summary: 'Return recent task projection events.',
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef('LimitQuery')],
        responses: {
          '200': jsonResponse('Recent task events.', {
            type: 'array',
            items: schemaRef('RegistryTaskEvent'),
          }),
          ...authErrorResponses,
        },
      },
    },
    '/tasks/stream': {
      get: {
        operationId: 'streamRegistryTasks',
        tags: ['Tasks', 'Events'],
        summary: 'Stream recent and future task projection events.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'SSE stream containing RegistryTaskEvent payloads.',
            content: eventStreamContent(
              'Server-sent events whose data payload matches RegistryTaskEvent.',
              schemaRef('RegistryTaskEvent'),
            ),
          },
          ...authErrorResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'registry token or JWT',
        description:
          'Control-plane bearer authentication configured by registrationToken or auth middleware.',
      },
    },
    parameters: {
      AgentIdPath: {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
        },
        description: 'Registry agent id.',
      },
      LimitQuery: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
        },
        description: 'Maximum number of recent task events to return.',
      },
      McpCompatibleQuery: {
        name: 'mcpCompatible',
        in: 'query',
        required: false,
        schema: {
          type: 'boolean',
        },
        description: 'Filter agents by MCP compatibility.',
      },
      NameQuery: {
        name: 'name',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
        },
        description: 'Filter agents by agent card name.',
      },
      PublicQuery: {
        name: 'public',
        in: 'query',
        required: false,
        schema: {
          type: 'boolean',
        },
        description: 'When true, return only public agents and allow anonymous reads.',
      },
      SkillQuery: {
        name: 'skill',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
        },
        description: 'Filter agents by skill name.',
      },
      StatusQuery: {
        name: 'status',
        in: 'query',
        required: false,
        schema: schemaRef('AgentStatus'),
        description: 'Filter agents by health status.',
      },
      TagQuery: {
        name: 'tag',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
        },
        description: 'Filter agents by skill tag.',
      },
      TransportQuery: {
        name: 'transport',
        in: 'query',
        required: false,
        schema: schemaRef('AgentTransport'),
        description: 'Filter agents by transport.',
      },
    },
    responses: {
      BadRequest: problemResponse('Request validation failed.', schemaRef('ErrorResponse')),
      Forbidden: problemResponse(
        'The caller cannot access the requested resource.',
        schemaRef('ErrorResponse'),
      ),
      NotFound: problemResponse(
        'The requested resource was not found.',
        schemaRef('ErrorResponse'),
      ),
      RateLimited: jsonResponse(
        'The request was rejected by rate limiting.',
        schemaRef('RateLimitErrorResponse'),
      ),
      Unauthorized: problemResponse(
        'Control-plane authentication failed.',
        schemaRef('AuthErrorResponse'),
      ),
      ValidationError: problemResponse(
        'The import document or request body failed validation.',
        schemaRef('ValidationErrorResponse'),
      ),
    },
    schemas: {
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
    },
  },
} as const;
