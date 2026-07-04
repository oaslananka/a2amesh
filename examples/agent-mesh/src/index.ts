import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import {
  A2AClient,
  A2AServer,
  AgentRegistryClient,
  type AgentCard,
  type Artifact,
  type Message,
  type RegisteredAgent,
  type Task,
} from '@a2amesh/runtime';
import { RegistryServer } from '@a2amesh/registry';

const token = process.env['AGENT_MESH_REGISTRY_TOKEN'] ?? 'local-registry-token';

const KNOWLEDGE: Record<string, string> = {
  a2a: 'The Agent2Agent (A2A) protocol lets independent AI agents discover each other via Agent Cards and exchange JSON-RPC messages, tasks, and artifacts, regardless of which framework built them.',
  mcp: 'The Model Context Protocol (MCP) standardizes how an LLM app calls external tools and resources through a client-server JSON-RPC interface.',
};

export interface AgentMeshExampleResult {
  mode: 'agent-mesh';
  discovered: string[];
  researchNotes: string;
  summary: string;
}

class ResearchAgent extends A2AServer {
  constructor() {
    super(createAgentCard('Researcher', 'Looks up facts on a topic.', 'research'), {
      allowLocalhost: true,
    });
  }

  override async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const topic = readText(message).toLowerCase();
    const key = Object.keys(KNOWLEDGE).find((candidate) => topic.includes(candidate));
    const facts = key ? KNOWLEDGE[key] : `No local knowledge about "${topic}".`;
    return [
      {
        artifactId: 'research-notes',
        name: 'Research notes',
        parts: [{ type: 'text', text: facts ?? '' }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

class SummarizerAgent extends A2AServer {
  constructor() {
    super(createAgentCard('Summarizer', 'Condenses text into one sentence.', 'summarize'), {
      allowLocalhost: true,
    });
  }

  override async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = readText(message);
    const firstSentence = text.split(/(?<=[.!?])\s/u)[0] ?? text;
    return [
      {
        artifactId: 'summary',
        name: 'Summary',
        parts: [{ type: 'text', text: `Summary: ${firstSentence}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

export async function runExample(): Promise<AgentMeshExampleResult> {
  const registry = new RegistryServer({
    allowLocalhost: true,
    registrationToken: token,
    healthPollingIntervalMs: 60_000,
    taskPollingIntervalMs: 60_000,
  });
  const registryServer = registry.start(Number(process.env['AGENT_MESH_REGISTRY_PORT'] ?? '0'));

  const researcher = new ResearchAgent();
  const researcherHttp = researcher.start(0);

  const summarizer = new SummarizerAgent();
  const summarizerHttp = summarizer.start(0);

  try {
    const registryUrl = await getServerUrl(registryServer);
    researcher.getAgentCard().url = await getServerUrl(researcherHttp);
    summarizer.getAgentCard().url = await getServerUrl(summarizerHttp);

    const registryClient = createRegistryClient(registryUrl);
    await registryClient.register(researcher.getAgentCard().url, researcher.getAgentCard());
    await registryClient.register(summarizer.getAgentCard().url, summarizer.getAgentCard());

    // Discover agents through the registry instead of hardcoding their URLs.
    const agents = await registryClient.listAgents();
    const researchEntry = findBySkill(agents, 'research');
    const summarizeEntry = findBySkill(agents, 'summar');

    const researchTask = await new A2AClient(researchEntry.url).sendMessage({
      message: createUserMessage('Tell me about A2A'),
    });
    const researchNotes = readArtifactText(researchTask);

    // Hand the first agent's output to the second agent as its input.
    const summaryTask = await new A2AClient(summarizeEntry.url).sendMessage({
      message: createUserMessage(researchNotes),
    });
    const summary = readArtifactText(summaryTask);

    return {
      mode: 'agent-mesh',
      discovered: agents.map((agent) => agent.card.name).sort(),
      researchNotes,
      summary,
    };
  } finally {
    await Promise.all([registry.stop(), researcher.stop(), summarizer.stop()]);
  }
}

function findBySkill(agents: RegisteredAgent[], term: string): RegisteredAgent {
  const match = agents.find((agent) =>
    agent.skills.some((skill) => skill.toLowerCase().includes(term)),
  );
  if (!match) {
    throw new Error(`No registered agent advertises a skill matching "${term}"`);
  }
  return match;
}

function readArtifactText(task: Task): string {
  const part = task.artifacts?.[0]?.parts[0];
  return part && part.type === 'text' ? part.text : '';
}

function createRegistryClient(baseUrl: string): AgentRegistryClient {
  return new AgentRegistryClient(baseUrl, async (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    headers.set('authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  });
}

function createAgentCard(name: string, description: string, skillId: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description,
    url: 'http://127.0.0.1:0',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      {
        id: skillId,
        name: `${name} skill`,
        description,
        tags: [skillId],
      },
    ],
  };
}

function createUserMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function readText(message: Message): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ');
}

async function getServerUrl(server: Server): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve local server port');
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runExample()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
