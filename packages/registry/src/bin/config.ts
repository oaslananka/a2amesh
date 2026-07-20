import type { RegistryServerOptions } from '../RegistryServer.js';

type RegistryStorageBackend = 'memory' | 'sqlite';

export interface RegistryProcessConfig {
  port: number;
  storageBackend: RegistryStorageBackend;
  sqlitePath?: string;
  trustLogPath?: string;
  serverOptions: RegistryServerOptions;
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be a boolean value.`);
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readOptionalString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function readCsv(env: NodeJS.ProcessEnv, name: string): string[] {
  const raw = env[name]?.trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function readAudience(env: NodeJS.ProcessEnv): string | string[] | undefined {
  const values = readCsv(env, 'REGISTRY_AUTH_AUDIENCE');
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

function urlHostname(value: string | undefined): string | undefined {
  return value ? new URL(value).hostname.toLowerCase() : undefined;
}

type RegistryAuthScheme = NonNullable<RegistryServerOptions['auth']>['securitySchemes'][number];

function createAuthScheme(args: {
  discoveryUrl?: string;
  jwksUri?: string;
  issuer?: string;
  audience?: string | string[];
  algorithms: string[];
}): RegistryAuthScheme {
  const shared = {
    ...(args.issuer ? { issuer: args.issuer } : {}),
    ...(args.audience ? { audience: args.audience } : {}),
    ...(args.algorithms.length > 0 ? { algorithms: args.algorithms } : {}),
  };
  if (args.discoveryUrl) {
    return {
      id: 'registry-oidc',
      type: 'openIdConnect',
      openIdConnectUrl: args.discoveryUrl,
      ...(args.jwksUri ? { jwksUri: args.jwksUri } : {}),
      ...shared,
    };
  }
  if (!args.jwksUri) {
    throw new Error('REGISTRY_AUTH_JWKS_URI is required for JWT auth.');
  }
  return {
    id: 'registry-jwt',
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    jwksUri: args.jwksUri,
    ...shared,
  };
}

function readAuthAllowedHostnames(
  env: NodeJS.ProcessEnv,
  discoveryUrl: string | undefined,
  jwksUri: string | undefined,
): string[] {
  const configured = readCsv(env, 'REGISTRY_AUTH_ALLOWED_HOSTNAMES').map((value) =>
    value.toLowerCase(),
  );
  const inferred = [urlHostname(discoveryUrl), urlHostname(jwksUri)].filter(
    (value): value is string => Boolean(value),
  );
  return Array.from(new Set([...configured, ...inferred]));
}

function createJwtAuthOptions(env: NodeJS.ProcessEnv): RegistryServerOptions['auth'] {
  const discoveryUrl = readOptionalString(env, 'REGISTRY_OIDC_DISCOVERY_URL');
  const jwksUri = readOptionalString(env, 'REGISTRY_AUTH_JWKS_URI');
  if (!discoveryUrl && !jwksUri) return undefined;

  const issuer = readOptionalString(env, 'REGISTRY_AUTH_ISSUER');
  const audience = readAudience(env);
  const scheme = createAuthScheme({
    ...(discoveryUrl ? { discoveryUrl } : {}),
    ...(jwksUri ? { jwksUri } : {}),
    ...(issuer ? { issuer } : {}),
    ...(audience ? { audience } : {}),
    algorithms: readCsv(env, 'REGISTRY_AUTH_ALGORITHMS'),
  });
  return {
    securitySchemes: [scheme],
    security: [{ [scheme.id]: [] }],
    outboundPolicy: {
      timeoutMs: readPositiveInteger(env, 'REGISTRY_AUTH_TIMEOUT_MS', 5_000),
      retries: readPositiveInteger(env, 'REGISTRY_AUTH_RETRY_ATTEMPTS', 1) - 1,
      allowLocalhost: readBoolean(env, 'REGISTRY_AUTH_ALLOW_LOCALHOST', false),
      allowNetworkTargets: readBoolean(env, 'REGISTRY_AUTH_ALLOW_PRIVATE_NETWORKS', false),
      allowUnresolvedHostnames: false,
      allowedHostnames: readAuthAllowedHostnames(env, discoveryUrl, jwksUri),
    },
  };
}

function readStorageBackend(env: NodeJS.ProcessEnv): RegistryStorageBackend {
  const backend = (env['REGISTRY_STORAGE_BACKEND']?.trim().toLowerCase() || 'memory') as string;
  if (backend !== 'memory' && backend !== 'sqlite') {
    throw new Error('REGISTRY_STORAGE_BACKEND must be memory or sqlite.');
  }
  return backend;
}

export function resolveRegistryProcessConfig(
  env: NodeJS.ProcessEnv = process.env,
): RegistryProcessConfig {
  const port = readPositiveInteger(env, 'PORT', 3099);
  const token = readOptionalString(env, 'REGISTRY_TOKEN');
  const auth = createJwtAuthOptions(env);
  if (token && auth) {
    throw new Error('REGISTRY_TOKEN cannot be combined with JWT/OIDC registry authentication.');
  }

  const allowedOrigins = readCsv(env, 'REGISTRY_ALLOWED_ORIGINS');
  const allowedHostnames = readCsv(env, 'REGISTRY_ALLOWED_HOSTNAMES').map((value) =>
    value.toLowerCase(),
  );
  const allowLocalhost = readBoolean(env, 'ALLOW_LOCALHOST', env['NODE_ENV'] !== 'production');
  const allowPrivateNetworks = readBoolean(env, 'ALLOW_PRIVATE_NETWORKS', false);
  const allowUnresolvedHostnames = readBoolean(env, 'ALLOW_UNRESOLVED_HOSTNAMES', false);
  const storageBackend = readStorageBackend(env);
  const sqlitePath = readOptionalString(env, 'REGISTRY_SQLITE_PATH');
  if (storageBackend === 'sqlite' && !sqlitePath) {
    throw new Error('REGISTRY_SQLITE_PATH is required for sqlite registry storage.');
  }
  const trustLogPath = readOptionalString(env, 'REGISTRY_TRUST_LOG_PATH');

  const requireAuth = readBoolean(
    env,
    'REGISTRY_REQUIRE_AUTH',
    Boolean(token || auth || env['NODE_ENV'] === 'production'),
  );
  if (!requireAuth && (token || auth)) {
    throw new Error(
      'REGISTRY_REQUIRE_AUTH=false cannot be combined with static token or JWT/OIDC authentication.',
    );
  }

  return {
    port,
    storageBackend,
    ...(sqlitePath ? { sqlitePath } : {}),
    ...(trustLogPath ? { trustLogPath } : {}),
    serverOptions: {
      allowLocalhost,
      allowPrivateNetworks,
      allowUnresolvedHostnames,
      outboundPolicy: {
        allowLocalhost,
        allowPrivateNetworks,
        allowUnresolvedHostnames,
        ...(allowedHostnames.length > 0 ? { allowedHostnames } : {}),
      },
      ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
      requireOrigin: readBoolean(env, 'REGISTRY_REQUIRE_ORIGIN', false),
      requireAuth,
      ...(token ? { registrationToken: token } : {}),
      ...(auth ? { auth } : {}),
      distributedPollingLeases: readBoolean(
        env,
        'REGISTRY_DISTRIBUTED_POLLING_LEASES',
        storageBackend === 'sqlite',
      ),
      pollingLeaseOwnerId:
        readOptionalString(env, 'REGISTRY_POLLING_LEASE_OWNER_ID') ??
        readOptionalString(env, 'POD_NAME') ??
        'registry-process',
    },
  };
}
