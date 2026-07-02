#!/usr/bin/env node
import { RegistryServer } from '../index.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: a2amesh-registry

Starts the A2A Mesh registry server.

Environment:
  PORT                         Port to listen on (default: 3099)
  REGISTRY_TOKEN               Optional control-plane bearer token
  REGISTRY_ALLOWED_ORIGINS     Comma-separated CORS allowlist
  REGISTRY_REQUIRE_ORIGIN      Require Origin on control-plane requests
  ALLOW_LOCALHOST              Allow localhost agent URLs
  ALLOW_PRIVATE_NETWORKS       Allow private-network agent URLs
  ALLOW_UNRESOLVED_HOSTNAMES   Allow unresolved agent hostnames
`);
  process.exit(0);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const port = Number(process.env['PORT'] ?? '3099');
const registrationToken = process.env['REGISTRY_TOKEN']?.trim() || undefined;
const allowedOrigins = process.env['REGISTRY_ALLOWED_ORIGINS']
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = new RegistryServer({
  allowLocalhost: readBoolean('ALLOW_LOCALHOST', process.env['NODE_ENV'] !== 'production'),
  allowPrivateNetworks: readBoolean('ALLOW_PRIVATE_NETWORKS', false),
  allowUnresolvedHostnames: readBoolean('ALLOW_UNRESOLVED_HOSTNAMES', false),
  ...(allowedOrigins && allowedOrigins.length > 0 ? { allowedOrigins } : {}),
  requireOrigin: readBoolean('REGISTRY_REQUIRE_ORIGIN', false),
  requireAuth: Boolean(registrationToken),
  ...(registrationToken ? { registrationToken } : {}),
});

server.start(port);
process.stdout.write(`Registry running on :${port}\n`);
