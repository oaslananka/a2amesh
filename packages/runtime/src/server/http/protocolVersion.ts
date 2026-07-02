import type { Request } from 'express';
import { ErrorCodes, JsonRpcError } from '../../types/jsonrpc.js';

const A2A_VERSION_HEADER = 'A2A-Version';
export const A2A_REST_MEDIA_TYPE = 'application/a2a+json';
export const A2A_VERSION_NOT_SUPPORTED_PROBLEM_TYPE =
  'https://a2a-protocol.org/errors/version-not-supported';

export const SUPPORTED_A2A_PROTOCOL_VERSIONS = ['1.0', '1.2', '0.3'] as const;
export type SupportedA2AProtocolVersion = (typeof SUPPORTED_A2A_PROTOCOL_VERSIONS)[number];

function getRequestedA2AProtocolVersion(req: Request): string {
  const headerValue = req.get(A2A_VERSION_HEADER);
  const queryValue = req.query[A2A_VERSION_HEADER] ?? req.query[A2A_VERSION_HEADER.toLowerCase()];
  const raw = firstString(headerValue ?? queryValue);
  return raw && raw.trim().length > 0 ? raw.trim() : '0.3';
}

export function assertSupportedA2AProtocolVersion(req: Request): SupportedA2AProtocolVersion {
  const requestedVersion = getRequestedA2AProtocolVersion(req);
  if (isSupportedA2AProtocolVersion(requestedVersion)) {
    return requestedVersion;
  }

  throw new JsonRpcError(
    ErrorCodes.VersionNotSupported,
    `The requested A2A protocol version ${requestedVersion} is not supported by this agent`,
    {
      requestedVersion,
      supportedVersions: SUPPORTED_A2A_PROTOCOL_VERSIONS.join(','),
    },
  );
}

function isSupportedA2AProtocolVersion(version: string): version is SupportedA2AProtocolVersion {
  return (SUPPORTED_A2A_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return firstString(value[0]);
  }
  return typeof value === 'string' ? value : undefined;
}
