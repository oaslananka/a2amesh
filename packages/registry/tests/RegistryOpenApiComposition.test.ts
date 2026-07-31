import { describe, expect, it } from 'vitest';
import { registryOpenApiDocument } from '../src/openapi.js';
import { registryOpenApiComponents } from '../src/openapi/registryOpenApiComponents.js';
import { registryOpenApiPaths } from '../src/openapi/registryOpenApiPaths.js';
import { registryOpenApiSchemas } from '../src/openapi/registryOpenApiSchemas.js';

describe('registry OpenAPI composition', () => {
  it('composes the public document from cohesive path and component modules', () => {
    expect(registryOpenApiDocument.paths).toBe(registryOpenApiPaths);
    expect(registryOpenApiDocument.components).toBe(registryOpenApiComponents);
    expect(registryOpenApiComponents.schemas).toBe(registryOpenApiSchemas);
  });

  it('retains the complete path and schema inventory', () => {
    expect(Object.keys(registryOpenApiPaths)).toHaveLength(20);
    expect(Object.keys(registryOpenApiSchemas)).toEqual(
      expect.arrayContaining([
        'AgentCard',
        'RegisteredAgent',
        'RegistryOperatorContext',
        'RegistryTaskEvent',
        'TrustLogEntry',
      ]),
    );
    expect(Object.keys(registryOpenApiSchemas)).toHaveLength(23);
  });
});
