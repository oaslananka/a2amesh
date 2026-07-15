import {
  A2AClient,
  logger,
  type AgentCard,
  type Artifact,
  type Message,
  type Part,
  type Task,
} from '@a2amesh/runtime';
import { BaseAdapter } from '@a2amesh/internal-adapter-base';

interface OrchestratorAgentOptions {
  url: string;
  researcherUrl: string;
  writerUrl: string;
}

function createOrchestratorCard(url: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Orchestrator Agent',
    description: 'Coordinates the demo pipeline by delegating to research and writing specialists.',
    url,
    version: '1.0.0',
    provider: { name: 'a2amesh demo', url: 'https://github.com/oaslananka/a2amesh' },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      extendedAgentCard: false,
    },
    skills: [
      {
        id: 'orchestrate',
        name: 'Orchestrate',
        description: 'Plans, delegates, and returns a final answer.',
        tags: ['workflow', 'orchestration', 'pipeline'],
        examples: ['Explain the A2A Protocol in a concise, polished way.'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTextArtifact(task: Task): string {
  const textPart = task.artifacts
    ?.flatMap((artifact: NonNullable<Task['artifacts']>[number]) => artifact.parts)
    .find((part: Part) => part.type === 'text');

  if (textPart?.type !== 'text') {
    throw new Error('Task completed without a text artifact');
  }

  return textPart.text;
}

export class OrchestratorAgent extends BaseAdapter {
  private readonly researcherClient: A2AClient;
  private readonly writerClient: A2AClient;

  constructor(options: OrchestratorAgentOptions) {
    super(createOrchestratorCard(options.url));
    this.researcherClient = new A2AClient(options.researcherUrl);
    this.writerClient = new A2AClient(options.writerUrl);
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    logger.info('Orchestrator received task', { taskId: task.id });

    const inputText = message.parts.find((part: Part) => part.type === 'text');
    if (!inputText || inputText.type !== 'text') {
      throw new Error('Orchestrator requires text input');
    }

    this.getTaskManager().updateTaskState(task.id, 'WAITING_ON_EXTERNAL', {
      role: 'agent',
      messageId: `orch-status-${Date.now()}`,
      timestamp: new Date().toISOString(),
      parts: [{ type: 'text', text: 'Delegating to Researcher Agent...' }],
    });

    const researchTask = await this.researcherClient.sendMessage({
      role: 'user',
      messageId: `research-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...(task.contextId ? { contextId: task.contextId } : {}),
      parts: [{ type: 'text', text: inputText.text }],
    });
    const completedResearch = await this.waitForCompletion(this.researcherClient, researchTask.id);
    const findings = extractTextArtifact(completedResearch);

    this.getTaskManager().updateTaskState(task.id, 'WAITING_ON_EXTERNAL', {
      role: 'agent',
      messageId: `orch-status-${Date.now() + 1}`,
      timestamp: new Date().toISOString(),
      parts: [{ type: 'text', text: 'Delegating refined draft to Writer Agent...' }],
    });

    const writerTask = await this.writerClient.sendMessage({
      role: 'user',
      messageId: `writer-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...(task.contextId ? { contextId: task.contextId } : {}),
      parts: [
        {
          type: 'text',
          text: [
            `User request: ${inputText.text}`,
            '',
            'Research findings:',
            findings,
            '',
            'Return a polished final answer that is concise, accurate, and publication-ready.',
          ].join('\n'),
        },
      ],
    });
    const completedWriterTask = await this.waitForCompletion(this.writerClient, writerTask.id);
    const finalText = extractTextArtifact(completedWriterTask);

    return [
      {
        artifactId: `orch-${Date.now()}`,
        name: 'Final response',
        description: 'Orchestrated response composed from specialist agents',
        parts: [{ type: 'text', text: finalText }],
        index: 0,
        lastChunk: true,
      },
    ];
  }

  private async waitForCompletion(client: A2AClient, taskId: string): Promise<Task> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const task = await client.getTask(taskId);
      if (task.status.state === 'COMPLETED') {
        return task;
      }
      if (task.status.state === 'FAILED' || task.status.state === 'CANCELED') {
        throw new Error(`Child task ended in state ${task.status.state}`);
      }

      await sleep(1_000);
    }

    throw new Error(`Timed out waiting for task ${taskId}`);
  }
}
