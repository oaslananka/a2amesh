import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  JsonRpcError,
  normalizeAgentCard,
  type AgentCard,
  type AgentCardV03,
  type GoogleRpcErrorInfo,
} from '../src/index.js';

const currentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'current',
  description: 'Current card',
  url: 'https://agent.example.com',
  version: '1.0.0',
};

describe('protocol runtime helpers', () => {
  it('returns current cards unchanged and maps every legacy runtime field', () => {
    expect(normalizeAgentCard(currentCard)).toBe(currentCard);

    const legacy: AgentCardV03 = {
      protocolVersion: '0.3',
      name: 'legacy',
      description: 'Legacy card',
      url: 'https://legacy.example.com',
      iconUrl: 'https://legacy.example.com/icon.png',
      provider: { name: 'provider', url: 'https://provider.example.com' },
      version: '0.3.0',
      capabilities: { streaming: true },
      supportsAuthenticatedExtendedCard: true,
      defaultInputMode: 'text/plain',
      defaultOutputMode: 'application/json',
      skills: [{ id: 'skill', name: 'Skill', description: 'A skill' }],
      authentication: [{ id: 'key', type: 'apiKey', in: 'header', name: 'X-API-Key' }],
    };

    expect(normalizeAgentCard(legacy)).toEqual(
      expect.objectContaining({
        protocolVersion: '1.0',
        iconUrl: legacy.iconUrl,
        provider: legacy.provider,
        capabilities: { streaming: true, extendedAgentCard: true },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['application/json'],
        skills: legacy.skills,
        securitySchemes: legacy.authentication,
      }),
    );

    expect(
      normalizeAgentCard({
        protocolVersion: '0.3',
        name: 'minimal',
        description: 'Minimal legacy card',
        url: 'https://minimal.example.com',
        version: '0.3.0',
      }),
    ).not.toHaveProperty('capabilities');
  });

  it('preserves valid Google error details and normalizes unknown metadata', () => {
    const detail: GoogleRpcErrorInfo = {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'CUSTOM',
      domain: 'a2a-protocol.org',
    };
    expect(new JsonRpcError(ErrorCodes.InvalidRequest, 'invalid', [detail]).data).toEqual([detail]);
    expect(new JsonRpcError(ErrorCodes.TaskNotFound, 'missing', { taskId: 42 }).data).toEqual([
      expect.objectContaining({ reason: 'TASK_NOT_FOUND', metadata: { taskId: '42' } }),
    ]);
    expect(new JsonRpcError(ErrorCodes.InternalError, 'failed', 'details').data).toEqual([
      expect.objectContaining({ reason: 'INTERNAL_ERROR', metadata: { details: 'details' } }),
    ]);
    expect(new JsonRpcError(ErrorCodes.InternalError, 'failed').data).toBeUndefined();
  });

  it('maps every protocol error code and safely stringifies circular metadata', () => {
    const expected = new Map<number, string>([
      [ErrorCodes.ParseError, 'PARSE_ERROR'],
      [ErrorCodes.InvalidRequest, 'INVALID_REQUEST'],
      [ErrorCodes.MethodNotFound, 'METHOD_NOT_FOUND'],
      [ErrorCodes.InvalidParams, 'INVALID_PARAMETERS'],
      [ErrorCodes.InternalError, 'INTERNAL_ERROR'],
      [ErrorCodes.TaskNotFound, 'TASK_NOT_FOUND'],
      [ErrorCodes.PushNotificationNotSupported, 'PUSH_NOTIFICATION_NOT_SUPPORTED'],
      [ErrorCodes.UnsupportedOperation, 'UNSUPPORTED_OPERATION'],
      [ErrorCodes.RateLimitExceeded, 'RATE_LIMIT_EXCEEDED'],
      [ErrorCodes.Unauthorized, 'UNAUTHORIZED'],
      [ErrorCodes.ExtensionRequired, 'EXTENSION_REQUIRED'],
      [ErrorCodes.InvalidTaskTransition, 'INVALID_TASK_TRANSITION'],
      [ErrorCodes.IdempotencyConflict, 'IDEMPOTENCY_CONFLICT'],
      [12345, 'A2A_ERROR'],
    ]);
    for (const [code, reason] of expected) {
      expect(new JsonRpcError(code, 'message', null).data?.[0]?.reason).toBe(reason);
    }

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(new JsonRpcError(12345, 'message', circular).data?.[0]?.metadata?.['self']).toBe(
      '[object Object]',
    );
  });
});
