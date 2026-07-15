import { describe, expect, it } from 'vitest';
import { resolveRegistryProcessConfig } from '../src/bin/config.js';

describe('resolveRegistryProcessConfig', () => {
  it('fails closed for production control-plane requests without configured credentials', () => {
    const config = resolveRegistryProcessConfig({ NODE_ENV: 'production' });
    expect(config.serverOptions.requireAuth).toBe(true);
    expect(config.serverOptions.registrationToken).toBeUndefined();
    expect(config.storageBackend).toBe('memory');
  });

  it('maps static token, tenant-safe outbound policy and sqlite persistence', () => {
    const config = resolveRegistryProcessConfig({
      NODE_ENV: 'production',
      PORT: '3099',
      REGISTRY_TOKEN: 'test-token',
      REGISTRY_STORAGE_BACKEND: 'sqlite',
      REGISTRY_SQLITE_PATH: '/var/lib/a2amesh/registry.sqlite',
      REGISTRY_TRUST_LOG_PATH: '/var/lib/a2amesh/trust-log.sqlite',
      REGISTRY_ALLOWED_HOSTNAMES: 'runtime.default.svc.cluster.local',
      ALLOW_PRIVATE_NETWORKS: 'true',
      REGISTRY_ALLOWED_ORIGINS: 'https://operator.example.com',
      POD_NAME: 'registry-0',
    });

    expect(config).toEqual(
      expect.objectContaining({
        port: 3099,
        storageBackend: 'sqlite',
        sqlitePath: '/var/lib/a2amesh/registry.sqlite',
        trustLogPath: '/var/lib/a2amesh/trust-log.sqlite',
      }),
    );
    expect(config.serverOptions).toEqual(
      expect.objectContaining({
        requireAuth: true,
        registrationToken: 'test-token',
        allowPrivateNetworks: true,
        allowedOrigins: ['https://operator.example.com'],
        distributedPollingLeases: true,
        pollingLeaseOwnerId: 'registry-0',
        outboundPolicy: expect.objectContaining({
          allowedHostnames: ['runtime.default.svc.cluster.local'],
        }),
      }),
    );
  });

  it('configures verified JWT auth with a bounded discovery allowlist', () => {
    const config = resolveRegistryProcessConfig({
      NODE_ENV: 'production',
      REGISTRY_OIDC_DISCOVERY_URL: 'https://id.example.com/.well-known/openid-configuration',
      REGISTRY_AUTH_AUDIENCE: 'registry-api',
      REGISTRY_AUTH_ISSUER: 'https://id.example.com',
      REGISTRY_AUTH_ALGORITHMS: 'RS256,ES256',
    });

    expect(config.serverOptions.auth).toEqual(
      expect.objectContaining({
        securitySchemes: [
          expect.objectContaining({
            id: 'registry-oidc',
            type: 'openIdConnect',
            audience: 'registry-api',
            issuer: 'https://id.example.com',
            algorithms: ['RS256', 'ES256'],
          }),
        ],
        outboundPolicy: expect.objectContaining({
          allowedHostnames: ['id.example.com'],
          allowNetworkTargets: false,
        }),
      }),
    );
  });

  it('rejects ambiguous auth and incomplete sqlite configuration', () => {
    expect(() =>
      resolveRegistryProcessConfig({
        REGISTRY_TOKEN: 'token',
        REGISTRY_AUTH_JWKS_URI: 'https://id.example.com/jwks.json',
      }),
    ).toThrow(/cannot be combined/);
    expect(() => resolveRegistryProcessConfig({ REGISTRY_STORAGE_BACKEND: 'sqlite' })).toThrow(
      /REGISTRY_SQLITE_PATH/,
    );
    expect(() =>
      resolveRegistryProcessConfig({
        REGISTRY_REQUIRE_AUTH: 'false',
        REGISTRY_TOKEN: 'token',
      }),
    ).toThrow(/REGISTRY_REQUIRE_AUTH=false/);
    expect(() => resolveRegistryProcessConfig({ PORT: '3099garbage' })).toThrow(/positive integer/);
  });
});
