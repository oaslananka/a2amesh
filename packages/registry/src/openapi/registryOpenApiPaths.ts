import {
  authErrorResponses,
  eventStreamContent,
  jsonContent,
  jsonResponse,
  mutationErrorResponses,
  operationalErrorResponses,
  paginatedAgentArrayResponse,
  parameterRef,
  registryReadErrorResponses,
  responseRef,
  routeGroup,
  schemaRef,
  textContent,
} from './openApiHelpers.js';

interface EventStreamRouteOptions {
  operationId: string;
  tags: string[];
  summary: string;
  responseDescription: string;
  eventDescription: string;
  payloadSchemaName: string;
}

const eventStreamRoute = ({
  operationId,
  tags,
  summary,
  responseDescription,
  eventDescription,
  payloadSchemaName,
}: EventStreamRouteOptions) => ({
  get: {
    operationId,
    tags,
    summary,
    security: [{ bearerAuth: [] }],
    responses: {
      '200': {
        description: responseDescription,
        content: eventStreamContent(eventDescription, schemaRef(payloadSchemaName)),
      },
      ...authErrorResponses,
    },
  },
});

interface AgentCollectionRouteOptions {
  operationId: string;
  summary: string;
  description: string;
  parameterNames: string[];
  responseDescription: string;
  includeBadRequest?: boolean;
}

const agentCollectionRoute = ({
  operationId,
  summary,
  description,
  parameterNames,
  responseDescription,
  includeBadRequest = false,
}: AgentCollectionRouteOptions) => ({
  get: {
    operationId,
    tags: ['Agents'],
    summary,
    description,
    security: [{ bearerAuth: [] }, {}],
    parameters: parameterNames.map(parameterRef),
    responses: {
      '200': paginatedAgentArrayResponse(responseDescription),
      ...(includeBadRequest ? { '400': responseRef('BadRequest') } : {}),
      ...authErrorResponses,
    },
  },
});

export const registryOpenApiPaths = {
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
  '/context': {
    get: {
      operationId: 'getRegistryOperatorContext',
      tags: ['Admin'],
      summary: 'Return the sanitized effective operator or public discovery context.',
      description:
        'Returns authentication method, tenant scope, visibility scope, and the configured health freshness budget without exposing credentials, token claims, roles, or scopes.',
      security: [{ bearerAuth: [] }, {}],
      parameters: [parameterRef('PublicQuery')],
      responses: {
        '200': jsonResponse(
          'Sanitized registry operator context.',
          schemaRef('RegistryOperatorContext'),
        ),
        ...authErrorResponses,
      },
    },
  },
  '/events': eventStreamRoute({
    operationId: 'streamRegistryEvents',
    tags: ['Events'],
    summary: 'Stream authenticated registry update events.',
    responseDescription: 'SSE stream containing registry_update events.',
    eventDescription: 'Server-sent events whose data payload matches RegistryEvent.',
    payloadSchemaName: 'RegistryEvent',
  }),
  '/agents/stream': eventStreamRoute({
    operationId: 'streamRegistryAgents',
    tags: ['Events', 'Agents'],
    summary: 'Stream authenticated normalized agent registry updates.',
    responseDescription: 'SSE stream containing normalized RegisteredAgent updates.',
    eventDescription: 'Server-sent events whose data payload matches RegisteredAgent.',
    payloadSchemaName: 'RegisteredAgent',
  }),
  '/agents': agentCollectionRoute({
    operationId: 'listRegistryAgents',
    summary: 'List registered agents.',
    description:
      'When public=true is supplied this endpoint returns public agents without control-plane authentication. Otherwise it requires the registry control-plane bearer token or JWT middleware.',
    parameterNames: ['PublicQuery', 'LimitQuery', 'CursorQuery'],
    responseDescription: 'Registered agents visible to the caller.',
  }),
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
  '/agents/search': agentCollectionRoute({
    operationId: 'searchRegistryAgents',
    summary: 'Search registered agents by capability or metadata.',
    description:
      'At least one filter is required. Public searches may omit authentication when public=true is supplied.',
    parameterNames: [
      'SkillQuery',
      'TagQuery',
      'NameQuery',
      'TransportQuery',
      'StatusQuery',
      'McpCompatibleQuery',
      'PublicQuery',
      'LimitQuery',
      'CursorQuery',
    ],
    responseDescription: 'Matching registered agents.',
    includeBadRequest: true,
  }),
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
  '/tasks/stream': eventStreamRoute({
    operationId: 'streamRegistryTasks',
    tags: ['Tasks', 'Events'],
    summary: 'Stream recent and future task projection events.',
    responseDescription: 'SSE stream containing RegistryTaskEvent payloads.',
    eventDescription: 'Server-sent events whose data payload matches RegistryTaskEvent.',
    payloadSchemaName: 'RegistryTaskEvent',
  }),
  '/trust-log': {
    get: {
      operationId: 'listRegistryTrustLog',
      tags: ['Trust'],
      summary: 'List trust log entries for verified Agent Card registrations.',
      description:
        'Returns entries in append order. Each entry is chained to the previous entry via entryHash, so tampering with an earlier entry changes every hash after it. Read-only and unauthenticated by design so downstream tooling can independently audit the chain.',
      parameters: [parameterRef('LimitQuery')],
      responses: {
        '200': jsonResponse('Trust log entries in append order.', {
          type: 'array',
          items: schemaRef('TrustLogEntry'),
        }),
        ...operationalErrorResponses,
      },
    },
  },
  '/trust-log/{cardHash}': {
    parameters: [parameterRef('CardHashPath')],
    get: {
      operationId: 'getRegistryTrustLogByCardHash',
      tags: ['Trust'],
      summary: 'List trust log entries for a specific Agent Card hash.',
      responses: {
        '200': jsonResponse('Trust log entries matching the card hash.', {
          type: 'array',
          items: schemaRef('TrustLogEntry'),
        }),
        ...operationalErrorResponses,
      },
    },
  },
} as const;
