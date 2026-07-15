#!/usr/bin/env node
import { bootstrapTelemetry, resolveTelemetryConfigFromEnv } from '@a2amesh/runtime';
import { RegistryServer } from '../RegistryServer.js';
import { SqliteAgentStorage } from '../storage/SqliteAgentStorage.js';
import { SqliteTrustLogStorage } from '../storage/SqliteTrustLogStorage.js';
import { resolveRegistryProcessConfig } from './config.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: a2amesh-registry

Starts the A2A Mesh registry server.

Environment:
  PORT                                 Port to listen on (default: 3099)
  REGISTRY_REQUIRE_AUTH                Require authentication for control-plane requests
  REGISTRY_TOKEN                       Static control-plane bearer token
  REGISTRY_ALLOWED_ORIGINS             Comma-separated CORS allowlist
  REGISTRY_REQUIRE_ORIGIN              Require Origin on control-plane requests
  REGISTRY_OIDC_DISCOVERY_URL          OIDC discovery document URL
  REGISTRY_AUTH_JWKS_URI               JWT verification JWKS URL
  REGISTRY_AUTH_ISSUER                 Expected JWT issuer
  REGISTRY_AUTH_AUDIENCE               Comma-separated JWT audiences
  REGISTRY_AUTH_ALGORITHMS             Comma-separated JWT algorithms
  REGISTRY_AUTH_ALLOWED_HOSTNAMES      Allowlist for discovery and JWKS requests
  REGISTRY_STORAGE_BACKEND             memory or sqlite (default: memory)
  REGISTRY_SQLITE_PATH                 SQLite agent directory database path
  REGISTRY_TRUST_LOG_PATH              SQLite trust-log database path
  REGISTRY_ALLOWED_HOSTNAMES           Outbound agent hostname allowlist
  REGISTRY_DISTRIBUTED_POLLING_LEASES  Coordinate polling through the configured storage
  REGISTRY_POLLING_LEASE_OWNER_ID      Stable polling lease owner identifier
  ALLOW_LOCALHOST                      Allow localhost agent URLs
  ALLOW_PRIVATE_NETWORKS               Allow private-network agent URLs
  ALLOW_UNRESOLVED_HOSTNAMES           Allow unresolved agent hostnames
  A2A_TELEMETRY_ENABLED                Enable OTLP traces and metrics
  OTEL_EXPORTER_OTLP_ENDPOINT          OTLP HTTP endpoint
  OTEL_SERVICE_NAME                    Telemetry service name
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const config = resolveRegistryProcessConfig();
  const storage =
    config.storageBackend === 'sqlite' && config.sqlitePath
      ? new SqliteAgentStorage(config.sqlitePath)
      : undefined;
  const trustLog = config.trustLogPath ? new SqliteTrustLogStorage(config.trustLogPath) : undefined;
  const telemetry = await bootstrapTelemetry(
    resolveTelemetryConfigFromEnv(process.env, {
      serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'a2amesh-registry',
      serviceVersion: process.env['A2A_SERVICE_VERSION'] ?? '0.0.0',
    }),
  );

  const registry = new RegistryServer({
    ...config.serverOptions,
    ...(storage ? { storage } : {}),
    ...(trustLog ? { trustLogStorage: trustLog } : {}),
  });
  registry.start(config.port);
  process.stdout.write(`Registry running on :${config.port}\n`);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await registry.stop();
    storage?.close();
    trustLog?.close();
    await telemetry.shutdown();
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
