import { jsonResponse, problemResponse, schemaRef } from './openApiHelpers.js';
import { registryOpenApiSchemas } from './registryOpenApiSchemas.js';

export const registryOpenApiComponents = {
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
    CardHashPath: {
      name: 'cardHash',
      in: 'path',
      required: true,
      schema: {
        type: 'string',
        minLength: 1,
      },
      description: 'SHA-256 hex digest of the canonicalized, signature-less Agent Card.',
    },
    CursorQuery: {
      name: 'cursor',
      in: 'query',
      required: false,
      schema: {
        type: 'string',
      },
      description: 'Pagination cursor returned by X-A2A-Registry-Page-Next-Cursor.',
    },
    LimitQuery: {
      name: 'limit',
      in: 'query',
      required: false,
      schema: {
        type: 'integer',
        minimum: 1,
      },
      description: 'Maximum number of recent task events or registered agents to return.',
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
    NotFound: problemResponse('The requested resource was not found.', schemaRef('ErrorResponse')),
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
  schemas: registryOpenApiSchemas,
} as const;
