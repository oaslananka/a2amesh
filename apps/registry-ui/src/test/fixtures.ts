import type { RegisteredAgent, RegistryTaskEvent } from '../api/registry';

export const researcherAgent: RegisteredAgent = {
  id: 'agent-researcher',
  url: 'https://registry.example/agents/researcher',
  status: 'healthy',
  tags: ['research', 'public'],
  tenantId: 'tenant-a',
  isPublic: true,
  registeredAt: '2026-04-06T09:55:00.000Z',
  lastHeartbeatAt: '2026-04-06T10:04:00.000Z',
  lastSuccessAt: '2026-04-06T10:03:30.000Z',
  card: {
    name: 'Researcher Agent',
    description: 'Finds and synthesizes source material.',
    version: '1.0.0',
    transport: 'http',
    capabilities: {
      streaming: true,
      mcpCompatible: true,
      stateTransitionHistory: true,
    },
    skills: [
      {
        id: 'research',
        name: 'Research',
        description: 'Researches topics',
        tags: ['web', 'sources'],
      },
    ],
  },
};

export const writerAgent: RegisteredAgent = {
  id: 'agent-writer',
  url: 'https://registry.example/agents/writer',
  status: 'unhealthy',
  tags: ['writing'],
  tenantId: 'tenant-a',
  consecutiveFailures: 2,
  health: {
    reason: 'Provider timeout while drafting reports. Last two heartbeat checks exceeded 10s.',
    checkedAt: '2026-04-06T10:04:20.000Z',
    remediationHints: [
      'Check OpenAI/Anthropic provider latency and API key quota before replaying tasks.',
      'Inspect registry-to-agent SSE connectivity for dropped writer task events.',
      'Replay the latest failed report task after provider health recovers.',
    ],
  },
  card: {
    name: 'Writer Agent',
    description: 'Turns research notes into polished output.',
    version: '1.0.0',
    transport: 'sse',
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    skills: [
      {
        id: 'write',
        name: 'Write',
        description: 'Creates polished output',
        tags: ['text'],
      },
    ],
  },
};

export const publicAgent: RegisteredAgent = {
  id: 'agent-public',
  url: 'https://registry.example/agents/public',
  status: 'unknown',
  tags: ['public'],
  isPublic: true,
  card: {
    name: 'Public Discovery Agent',
    description: 'Read-only public discovery endpoint.',
    version: '1.0.0',
    transport: 'http',
    skills: [
      {
        id: 'discover',
        name: 'Discover',
        description: 'Lists public capabilities',
      },
    ],
  },
};

export const completedTask: RegistryTaskEvent = {
  taskId: 'task-completed-001',
  agentId: researcherAgent.id,
  agentName: researcherAgent.card.name,
  agentUrl: researcherAgent.url,
  status: 'COMPLETED',
  updatedAt: '2026-04-06T10:00:00.000Z',
  contextId: 'ctx-research-001',
  summary: 'Collected and summarized research findings.',
  historyCount: 3,
  artifactCount: 1,
  task: {
    id: 'task-completed-001',
    contextId: 'ctx-research-001',
    status: {
      state: 'COMPLETED',
      timestamp: '2026-04-06T10:00:00.000Z',
    },
  },
};

export const workingTask: RegistryTaskEvent = {
  taskId: 'task-working-002',
  agentId: writerAgent.id,
  agentName: writerAgent.card.name,
  agentUrl: writerAgent.url,
  status: 'WORKING',
  updatedAt: '2026-04-06T10:00:03.000Z',
  summary: 'Drafting final report from research output.',
  historyCount: 4,
  artifactCount: 0,
  task: {
    id: 'task-working-002',
    status: {
      state: 'WORKING',
      timestamp: '2026-04-06T10:00:03.000Z',
    },
  },
};

export const failedTask: RegistryTaskEvent = {
  taskId: 'task-failed-003',
  agentId: writerAgent.id,
  agentName: writerAgent.card.name,
  agentUrl: writerAgent.url,
  status: 'FAILED',
  updatedAt: '2026-04-06T10:01:00.000Z',
  summary: 'Report generation failed after provider timeout.',
  historyCount: 5,
  artifactCount: 0,
  task: {
    id: 'task-failed-003',
    status: {
      state: 'FAILED',
      timestamp: '2026-04-06T10:01:00.000Z',
    },
  },
};
