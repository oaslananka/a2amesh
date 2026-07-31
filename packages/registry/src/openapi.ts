import { registryOpenApiComponents } from './openapi/registryOpenApiComponents.js';
import { registryOpenApiPaths } from './openapi/registryOpenApiPaths.js';

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
    {
      name: 'Trust',
      description: 'Append-only, hash-chained trust log for verified Agent Card registrations.',
    },
  ],
  paths: registryOpenApiPaths,
  components: registryOpenApiComponents,
} as const;
