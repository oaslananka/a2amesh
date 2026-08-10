import type { AgentCard, Message, MessageSendParams, Task } from '@a2amesh/runtime';
import { describe, expect, it } from 'vitest';
import {
  createConformanceMessageParams,
  hasRequiredConformanceFailures,
  parseConformanceProtocolVersion,
  runConformanceSuite,
} from '../src/testing/conformance.js';
import { getConformanceProfile, summarizeConformanceProfile } from '../src/testing/profiles.js';

const completedTask = {
  id: 'task-1',
  contextId: 'ctx-a2a-1-0',
  status: {
    state: 'COMPLETED',
    timestamp: '2026-05-24T12:00:01Z',
  },
  history: [],
  artifacts: [
    {
      artifactId: 'artifact-1',
      parts: [{ type: 'text', text: 'ok' }],
      index: 0,
      lastChunk: true,
    },
  ],
} satisfies Task;

function createAgentCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Fixture Agent',
    description: 'Conformance fixture endpoint',
    url: 'http://agent.test',
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
      extendedAgentCard: true,
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'echo', name: 'Echo', description: 'Echoes fixtures' }],
    ...overrides,
  };
}

describe('conformance fixture runner', () => {
  it('keeps the official strict profile fully supported and CI blocking', () => {
    const summary = summarizeConformanceProfile(getConformanceProfile('official-a2a-v1.0'));

    expect(summary.coverage).toEqual({
      total: 10,
      supported: 10,
      partial: 0,
      legacyAlias: 0,
      unsupported: 0,
      requiredUnsupported: 0,
    });
  });

  it('emits endpoint metadata, package version, skipped capabilities and passing cases', async () => {
    const sentMessages: MessageSendParams[] = [];
    const getTaskRequests: Array<{ taskId: string; historyLength?: number }> = [];
    const client = {
      resolveCard: async () => createAgentCard(),
      sendMessage: async (params: MessageSendParams) => {
        sentMessages.push(params);
        return completedTask;
      },
      getTask: async (taskId: string, historyLength?: number) => {
        getTaskRequests.push({ taskId, ...(historyLength !== undefined ? { historyLength } : {}) });
        return completedTask;
      },
    };

    const report = await runConformanceSuite({
      client,
      endpointUrl: 'http://agent.test',
      packageVersion: '1.0.3',
    });

    expect(report.schemaVersion).toBe('1.0');
    expect(report.package.name).toBe('a2amesh');
    expect(report.package.version).toBe('1.0.3');
    expect(report.endpoint.url).toBe('http://agent.test');
    expect(report.endpoint.agentName).toBe('Fixture Agent');
    expect(report.endpoint.protocolVersion).toBe('1.0');
    expect(report.profile.id).toBe('official-a2a-v1.0');
    expect(report.profile.strict).toBe(true);
    expect(report.profile.coverage).toMatchObject({
      total: 10,
      supported: 10,
      partial: 0,
      unsupported: 0,
      legacyAlias: 0,
      requiredUnsupported: 0,
    });
    expect(report.coverage.every((item) => item.status === 'supported')).toBe(true);
    expect(report.coverage).toContainEqual(
      expect.objectContaining({ id: 'fields.send-message-configuration', status: 'supported' }),
    );
    expect(report.coverage).toContainEqual(
      expect.objectContaining({ id: 'states.official-task-state-enum', status: 'supported' }),
    );
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBeGreaterThan(0);
    expect(report.skippedCapabilities.map((item) => item.capability)).toEqual([
      'streaming',
      'pushNotifications',
    ]);
    expect(report.cases.map((item) => item.id)).toEqual([
      'agent-card',
      'protocol-version',
      'message-send',
      'task-get',
      'capability.streaming',
      'capability.pushNotifications',
      'capability.stateTransitionHistory',
      'capability.extendedAgentCard',
    ]);
    expect(hasRequiredConformanceFailures(report)).toBe(false);
    expect(sentMessages[0]).toEqual(createConformanceMessageParams('1.0'));
    expect(sentMessages[0]?.configuration).toEqual(
      expect.objectContaining({ returnImmediately: false, historyLength: 1 }),
    );
    expect(getTaskRequests).toEqual([{ taskId: completedTask.id, historyLength: 0 }]);
  });

  it('accepts a direct Message response from message/send', async () => {
    const directMessage = {
      role: 'agent',
      parts: [{ type: 'text', text: 'direct response' }],
      messageId: 'message-direct-1',
      timestamp: '2026-08-10T18:00:00Z',
      contextId: 'ctx-direct-1',
    } satisfies Message;
    let getTaskCalled = false;
    const client = {
      resolveCard: async () => createAgentCard(),
      sendMessage: async () => directMessage,
      getTask: async () => {
        getTaskCalled = true;
        throw new Error('task-get should not run for a direct Message response');
      },
    };

    const report = await runConformanceSuite({
      client,
      endpointUrl: 'http://agent.test',
      packageVersion: '1.0.3',
    });

    expect(report.cases).toContainEqual(
      expect.objectContaining({
        id: 'message-send',
        required: true,
        status: 'pass',
        metadata: expect.objectContaining({
          responseKind: 'message',
          messageId: directMessage.messageId,
        }),
      }),
    );
    expect(report.cases).toContainEqual(
      expect.objectContaining({ id: 'task-get', required: true, status: 'skip' }),
    );
    expect(hasRequiredConformanceFailures(report)).toBe(false);
    expect(getTaskCalled).toBe(false);
  });

  it('marks required cases as failed when a fixture-backed request fails', async () => {
    const client = {
      resolveCard: async () => createAgentCard(),
      sendMessage: async () => {
        throw new Error('RPC rejected the message fixture');
      },
      getTask: async () => completedTask,
    };

    const report = await runConformanceSuite({
      client,
      endpointUrl: 'http://agent.test',
      packageVersion: '1.0.3',
    });

    expect(report.summary.failed).toBe(1);
    expect(report.cases).toContainEqual(
      expect.objectContaining({
        id: 'message-send',
        required: true,
        status: 'fail',
        message: 'RPC rejected the message fixture',
      }),
    );
    expect(hasRequiredConformanceFailures(report)).toBe(true);
  });

  it('rejects experimental fixture profiles unless parsing opts in', () => {
    expect(() => parseConformanceProtocolVersion('1.2')).toThrow('--experimental-profiles');
    expect(parseConformanceProtocolVersion('1.2', { allowExperimental: true })).toBe('1.2');
  });

  it('rejects experimental fixture profiles unless the runner opts in', async () => {
    const client = {
      resolveCard: async () => createAgentCard({ protocolVersion: '1.2', version: '1.2.0' }),
      sendMessage: async () => completedTask,
      getTask: async () => completedTask,
    };

    await expect(
      runConformanceSuite({
        client,
        endpointUrl: 'http://agent.test',
        packageVersion: '1.0.3',
        protocolVersion: '1.2',
      }),
    ).rejects.toThrow('Set experimentalProfiles to true');
  });

  it('runs experimental fixture profiles when explicitly enabled', async () => {
    const experimentalTask = {
      ...completedTask,
      contextId: 'ctx-a2a-1-2',
      status: {
        ...completedTask.status,
        timestamp: '2026-05-24T13:00:01+03:00',
      },
    } satisfies Task;
    const sentMessages: MessageSendParams[] = [];
    const client = {
      resolveCard: async () => createAgentCard({ protocolVersion: '1.2', version: '1.2.0' }),
      sendMessage: async (params: MessageSendParams) => {
        sentMessages.push(params);
        return experimentalTask;
      },
      getTask: async () => ({ ...experimentalTask, history: [] }),
    };

    const report = await runConformanceSuite({
      client,
      endpointUrl: 'http://agent.test',
      packageVersion: '1.0.3',
      protocolVersion: '1.2',
      experimentalProfiles: true,
    });

    expect(report.protocolVersion).toBe('1.2');
    expect(report.endpoint.protocolVersion).toBe('1.2');
    expect(report.coverage).toContainEqual(
      expect.objectContaining({ id: 'fields.send-message-configuration', status: 'supported' }),
    );
    expect(report.coverage).toContainEqual(
      expect.objectContaining({ id: 'states.official-task-state-enum', status: 'supported' }),
    );
    expect(report.summary.failed).toBe(0);
    expect(sentMessages[0]).toEqual(createConformanceMessageParams('1.2'));
  });
});
