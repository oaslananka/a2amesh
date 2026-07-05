import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentCardSchema,
  ExtensibleArtifactSchema,
  JsonRpcEnvelopeSchema,
  MessageSchema,
  REGISTRY_EXPORT_SCHEMA_ID,
  RegisteredAgentSchema,
  RegistryExportDocumentSchema,
  RegistryTaskEventSchema,
  TaskSchema,
  publicJsonSchemaDefinitions,
} from '../src/schemas/public.js';

const timestamp = '2026-04-06T10:00:00.000Z';

const agentCard = {
  protocolVersion: '1.2',
  name: 'Planner',
  description: 'Plans tasks.',
  url: 'https://agent.example.com/a2a',
  version: '1.0.0',
  skills: [
    {
      id: 'plan',
      name: 'Plan',
      description: 'Create a task plan.',
      tags: ['planning'],
    },
  ],
};

const message = {
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }],
  messageId: 'message-1',
  timestamp,
};

const task = {
  id: 'task-1',
  status: {
    state: 'COMPLETED',
    timestamp,
  },
  history: [message],
  artifacts: [
    {
      artifactId: 'artifact-1',
      parts: [{ type: 'data', data: { answer: 42 } }],
      index: 0,
      metadata: { source: 'test' },
    },
  ],
};

describe('public protocol schemas', () => {
  it('declares every generated schema artifact deterministically', () => {
    expect(publicJsonSchemaDefinitions.map((definition) => definition.fileName)).toEqual([
      'agent-card.schema.json',
      'message.schema.json',
      'task.schema.json',
      'cassette.schema.json',
      'artifact.schema.json',
      'json-rpc.schema.json',
      'registry-agent.schema.json',
      'registry-export.schema.json',
      'registry-task-event.schema.json',
    ]);

    for (const definition of publicJsonSchemaDefinitions) {
      const jsonSchema = z.toJSONSchema(definition.schema, {
        target: 'draft-2020-12',
        unrepresentable: 'throw',
        cycles: 'throw',
        reused: 'inline',
      });
      expect(jsonSchema).toHaveProperty('$schema', 'https://json-schema.org/draft/2020-12/schema');
    }
  });

  it('validates representative protocol and registry payloads', () => {
    expect(AgentCardSchema.parse(agentCard).name).toBe('Planner');
    expect(MessageSchema.parse(message).role).toBe('ROLE_USER');
    expect(TaskSchema.parse(task).status.state).toBe('COMPLETED');
    expect(ExtensibleArtifactSchema.parse(task.artifacts[0]).artifactId).toBe('artifact-1');
    expect(
      JsonRpcEnvelopeSchema.parse({
        jsonrpc: '2.0',
        method: 'message/send',
        params: { message },
        id: 'rpc-1',
      }).jsonrpc,
    ).toBe('2.0');
    expect(
      RegisteredAgentSchema.parse({
        id: 'agent-1',
        url: 'https://agent.example.com/a2a',
        card: agentCard,
        status: 'healthy',
        tags: ['planning'],
        skills: ['Plan'],
        registeredAt: timestamp,
      }).status,
    ).toBe('healthy');
    expect(
      RegistryTaskEventSchema.parse({
        taskId: 'task-1',
        agentId: 'agent-1',
        agentName: 'Planner',
        agentUrl: 'https://agent.example.com/a2a',
        status: 'COMPLETED',
        updatedAt: timestamp,
        historyCount: 1,
        artifactCount: 1,
        task,
      }).taskId,
    ).toBe('task-1');
    expect(
      RegistryExportDocumentSchema.parse({
        $schema: REGISTRY_EXPORT_SCHEMA_ID,
        schemaVersion: '1',
        exportedAt: timestamp,
        agents: [
          {
            id: 'agent-1',
            url: 'https://agent.example.com/a2a',
            card: agentCard,
            status: 'healthy',
            tags: ['planning'],
            skills: ['Plan'],
            registeredAt: timestamp,
            tenantId: 'tenant-a',
            isPublic: true,
          },
        ],
        metadata: {
          source: 'a2amesh-registry',
          agentCount: 1,
          tenants: ['tenant-a'],
          publicAgents: 1,
        },
      }).agents[0]?.id,
    ).toBe('agent-1');
  });
});
