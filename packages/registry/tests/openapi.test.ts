import { describe, expect, it } from 'vitest';
import { registryOpenApiDocument } from '../src/openapi.js';

describe('registry OpenAPI document', () => {
  it('publishes the supported operational and control-plane endpoints', () => {
    expect(registryOpenApiDocument).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'A2A Mesh Registry API', version: '1.0.0' },
      paths: expect.objectContaining({
        '/health': expect.any(Object),
        '/metrics': expect.any(Object),
        '/agents/register': expect.any(Object),
        '/tasks/recent': expect.any(Object),
        '/tasks/stream': expect.any(Object),
        '/admin/agents/export': expect.any(Object),
        '/admin/agents/import': expect.any(Object),
      }),
      components: expect.objectContaining({
        securitySchemes: expect.any(Object),
        schemas: expect.any(Object),
        responses: expect.any(Object),
      }),
    });

    const serialized = JSON.stringify(registryOpenApiDocument);
    expect(serialized).toContain('getRegistryHealth');
    expect(serialized).toContain('text/event-stream');
    expect(serialized).toContain('application/problem+json');
    expect(serialized).toContain('#/components/schemas/RegisteredAgent');
  });
});
