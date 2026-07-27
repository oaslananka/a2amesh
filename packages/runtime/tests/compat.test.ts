import { describe, expect, it } from 'vitest';
import {
  isTerminalTaskState,
  normalizeMessageRole,
  normalizeTaskState,
  taskStateMetadataKey,
} from '../src/utils/compat.js';
import { validateMessageSendParams } from '../src/utils/schema-validator.js';

describe('compat normalizers', () => {
  it('normalizes v0.3 task states to A2A v1.0 SCREAMING_SNAKE_CASE', () => {
    expect(normalizeTaskState('submitted')).toBe('SUBMITTED');
    expect(normalizeTaskState('queued')).toBe('QUEUED');
    expect(normalizeTaskState('working')).toBe('WORKING');
    expect(normalizeTaskState('input-required')).toBe('INPUT_REQUIRED');
    expect(normalizeTaskState('input_required')).toBe('INPUT_REQUIRED');
    expect(normalizeTaskState('waiting_on_external')).toBe('WAITING_ON_EXTERNAL');
    expect(normalizeTaskState('waiting-on-external')).toBe('WAITING_ON_EXTERNAL');
    expect(normalizeTaskState('completed')).toBe('COMPLETED');
    expect(normalizeTaskState('failed')).toBe('FAILED');
    expect(normalizeTaskState('canceled')).toBe('CANCELED');
    expect(normalizeTaskState('rejected')).toBe('REJECTED');
  });

  it('normalizes legacy message roles to A2A v1.0 role constants', () => {
    expect(normalizeMessageRole('user')).toBe('ROLE_USER');
    expect(normalizeMessageRole('agent')).toBe('ROLE_AGENT');
    expect(normalizeMessageRole('ROLE_USER')).toBe('ROLE_USER');
    expect(normalizeMessageRole('ROLE_AGENT')).toBe('ROLE_AGENT');
  });

  it('classifies every terminal and non-terminal A2A state explicitly', () => {
    for (const state of ['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']) {
      expect(isTerminalTaskState(state)).toBe(true);
    }
    expect(isTerminalTaskState('rejected')).toBe(true);
    for (const state of [
      'SUBMITTED',
      'QUEUED',
      'WORKING',
      'INPUT_REQUIRED',
      'AUTH_REQUIRED',
      'WAITING_ON_EXTERNAL',
    ]) {
      expect(isTerminalTaskState(state)).toBe(false);
    }
  });

  it('derives exact metadata keys for special and default task states', () => {
    expect(taskStateMetadataKey('INPUT_REQUIRED')).toBe('inputRequiredAt');
    expect(taskStateMetadataKey('AUTH_REQUIRED')).toBe('authRequiredAt');
    expect(taskStateMetadataKey('WAITING_ON_EXTERNAL')).toBe('waitingOnExternalAt');
    expect(taskStateMetadataKey('COMPLETED')).toBe('completedAt');
    expect(taskStateMetadataKey('FAILED')).toBe('failedAt');
  });

  it('normalizes message roles during schema validation', () => {
    const params = validateMessageSendParams({
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        messageId: 'message-1',
        timestamp: new Date().toISOString(),
      },
    });

    expect(params.message.role).toBe('ROLE_USER');
  });

  it('rejects unknown legacy task states and message roles', () => {
    expect(() => normalizeTaskState('done')).toThrow(/Unsupported task state/);
    expect(() => normalizeMessageRole('assistant')).toThrow(/Unsupported message role/);
  });
});
