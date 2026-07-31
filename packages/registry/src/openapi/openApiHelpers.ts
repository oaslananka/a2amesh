export type SchemaObject = Record<string, unknown>;

export const jsonContent = (schema: SchemaObject) => ({
  'application/json': {
    schema,
  },
});

export const textContent = (schema: SchemaObject) => ({
  'text/plain': {
    schema,
  },
});

export const eventStreamContent = (description: string, payloadSchema: SchemaObject) => ({
  'text/event-stream': {
    schema: {
      type: 'string',
      description,
    },
    'x-a2a-event-payload-schema': payloadSchema,
  },
});

export const schemaRef = (name: string): SchemaObject => ({
  $ref: `#/components/schemas/${name}`,
});

export const responseRef = (name: string): SchemaObject => ({
  $ref: `#/components/responses/${name}`,
});

export const parameterRef = (name: string): SchemaObject => ({
  $ref: `#/components/parameters/${name}`,
});

export const jsonResponse = (description: string, schema: SchemaObject) => ({
  description,
  content: jsonContent(schema),
});

const problemContent = (schema: SchemaObject) => ({
  'application/problem+json': {
    schema,
  },
});

export const problemResponse = (description: string, schema: SchemaObject) => ({
  description,
  content: problemContent(schema),
});

export const stringArraySchema = {
  type: 'array',
  items: {
    type: 'string',
  },
};

export const timestampSchema = {
  type: 'string',
  format: 'date-time',
};

export const routeGroup = (
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

export const registeredAgentArray = {
  type: 'array',
  items: schemaRef('RegisteredAgent'),
};

const paginationHeaders = {
  'X-A2A-Registry-Page-Total': {
    description: 'Total number of matching registered agents before pagination.',
    schema: { type: 'integer', minimum: 0 },
  },
  'X-A2A-Registry-Page-Count': {
    description: 'Number of registered agents returned in this response body.',
    schema: { type: 'integer', minimum: 0 },
  },
  'X-A2A-Registry-Page-Next-Cursor': {
    description: 'Cursor to request the next page. Omitted when there is no next page.',
    schema: { type: 'string' },
  },
};

export const paginatedAgentArrayResponse = (description: string) => ({
  ...jsonResponse(description, registeredAgentArray),
  headers: paginationHeaders,
});

export const authErrorResponses = {
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '429': responseRef('RateLimited'),
};

export const operationalErrorResponses = {
  '403': responseRef('Forbidden'),
  '429': responseRef('RateLimited'),
};

export const mutationErrorResponses = {
  '400': responseRef('BadRequest'),
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '404': responseRef('NotFound'),
  '429': responseRef('RateLimited'),
};

export const registryReadErrorResponses = {
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '404': responseRef('NotFound'),
  '429': responseRef('RateLimited'),
};
