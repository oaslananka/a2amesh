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

  it('configures shared Redis storage for multi-process registry state', () => {
    const config = resolveRegistryProcessConfig({
      NODE_ENV: 'production',
      REGISTRY_TOKEN: 'test-token',
      REGISTRY_STORAGE_BACKEND: 'redis',
      REGISTRY_REDIS_URL: 'redis://registry-redis.default.svc.cluster.local:6379/0',
      REGISTRY_REDIS_PREFIX: 'a2a:registry:production',
      POD_NAME: 'registry-1',
    });

    expect(config).toEqual(
      expect.objectContaining({
        storageBackend: 'redis',
        redisUrl: 'redis://registry-redis.default.svc.cluster.local:6379/0',
        redisPrefix: 'a2a:registry:production',
      }),
    );
    expect(config.serverOptions).toEqual(
      expect.objectContaining({
        distributedPollingLeases: true,
        pollingLeaseOwnerId: 'registry-1',
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

  it('configures direct JWT verification and merges explicit auth hostnames', () => {
    const config = resolveRegistryProcessConfig({
      NODE_ENV: 'production',
      REGISTRY_AUTH_JWKS_URI: 'https://keys.example.com/jwks.json',
      REGISTRY_AUTH_AUDIENCE: 'registry-api,registry-operator',
      REGISTRY_AUTH_ALLOWED_HOSTNAMES: 'keys.example.com,backup.example.com,keys.example.com',
      REGISTRY_AUTH_ALLOW_PRIVATE_NETWORKS: 'true',
      REGISTRY_AUTH_RETRY_ATTEMPTS: '2',
    });

    expect(config.serverOptions.auth).toEqual(
      expect.objectContaining({
        securitySchemes: [
          expect.objectContaining({
            id: 'registry-jwt',
            type: 'http',
            scheme: 'bearer',
            jwksUri: 'https://keys.example.com/jwks.json',
            audience: ['registry-api', 'registry-operator'],
          }),
        ],
        outboundPolicy: expect.objectContaining({
          allowedHostnames: ['keys.example.com', 'backup.example.com'],
          allowNetworkTargets: true,
          retries: 1,
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
    expect(() =>
      resolveRegistryProcessConfig({
        REGISTRY_STORAGE_BACKEND: 'redis',
      }),
    ).toThrow(/REGISTRY_REDIS_URL/);
    expect(() =>
      resolveRegistryProcessConfig({
        REGISTRY_STORAGE_BACKEND: 'redis',
        REGISTRY_REDIS_URL: 'redis://localhost:6379',
        REGISTRY_TRUST_LOG_PATH: '/var/lib/a2amesh/trust-log.sqlite',
      }),
    ).toThrow(/REGISTRY_TRUST_LOG_PATH/);
    expect(() => resolveRegistryProcessConfig({ PORT: '3099garbage' })).toThrow(/positive integer/);
  });
});
