import 'dotenv/config';
import type { Server } from 'node:http';
import {
  AgentRegistryClient,
  bootstrapTelemetry,
  createOutboundPolicyFetch,
  resolveTelemetryConfigFromEnv,
  type AgentCard,
} from '@a2amesh/runtime';
import { RegistryServer } from '@a2amesh/registry';
import { getDemoConfig, type DemoConfig } from './config.js';
import { OrchestratorAgent } from './orchestrator-agent.js';
import { ResearcherAgent } from './researcher-agent.js';
import { createWriterAgent } from './writer-agent.js';

interface DemoAgent {
  start(port: number): Server;
  stop(): void;
  getAgentCard(): AgentCard;
}

function urlHostname(urlString: string): string {
  return new URL(urlString).hostname.toLowerCase();
}

function isLoopbackRegistry(urlString: string): boolean {
  const hostname = urlHostname(urlString);
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function createRegistryFetch(config: DemoConfig): typeof fetch {
  const policyFetch = createOutboundPolicyFetch({
    allowLocalhost: isLoopbackRegistry(config.registryUrl),
    allowPrivateNetworks: config.allowPrivateNetworks,
    allowedHostnames: config.registryAllowedHostnames,
    telemetryLabels: {
      'a2a.operation': 'runtime-registry',
    },
  });

  return async (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (config.registryToken) {
      headers.set('Authorization', `Bearer ${config.registryToken}`);
    }
    if (config.registryTenantId) {
      headers.set('x-tenant-id', config.registryTenantId);
    }
    headers.set('x-principal-id', config.registryPrincipalId);

    return policyFetch(input, {
      ...init,
      headers,
    });
  };
}

async function waitForListening(server: Server): Promise<void> {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function ensureRegistryStarted(config: DemoConfig) {
  const registryFetch = createRegistryFetch(config);
  const registryClient = new AgentRegistryClient(config.registryUrl, registryFetch);

  try {
    await registryClient.health();
    return {
      registryClient,
      shutdown: async () => {},
    };
  } catch (error) {
    if (!config.runEmbeddedRegistry) {
      throw error;
    }
  }

  const embeddedAllowedHostnames = Array.from(
    new Set([
      urlHostname(config.researcherUrl),
      urlHostname(config.writerUrl),
      urlHostname(config.orchestratorUrl),
    ]),
  );
  const registry = new RegistryServer({
    allowLocalhost: true,
    allowPrivateNetworks: config.allowPrivateNetworks,
    outboundPolicy: {
      allowLocalhost: true,
      allowPrivateNetworks: config.allowPrivateNetworks,
      allowedHostnames: embeddedAllowedHostnames,
    },
    requireAuth: Boolean(config.registryToken),
    ...(config.registryToken ? { registrationToken: config.registryToken } : {}),
  });
  const server = registry.start(config.registryPort);
  await waitForListening(server);

  return {
    registryClient,
    shutdown: async () => {
      await registry.stop();
    },
  };
}

async function startAgent(server: DemoAgent, port: number): Promise<Server> {
  const httpServer = server.start(port);
  await waitForListening(httpServer);
  return httpServer;
}

async function main() {
  const telemetry = await bootstrapTelemetry(
    resolveTelemetryConfigFromEnv(process.env, {
      serviceName: 'a2amesh-runtime-demo',
      serviceVersion: process.env['A2A_SERVICE_VERSION'] ?? '0.0.0',
    }),
  );

  try {
    const config = getDemoConfig();

    if (!process.env['OPENAI_API_KEY']) {
      throw new Error('OPENAI_API_KEY is required. Copy .env.example to .env and add your key.');
    }

    const { registryClient, shutdown } = await ensureRegistryStarted(config);

    const researcher = new ResearcherAgent(config.researcherUrl) as unknown as DemoAgent;
    const writer = createWriterAgent(config.writerUrl) as unknown as DemoAgent;
    const orchestrator = new OrchestratorAgent({
      url: config.orchestratorUrl,
      researcherUrl: config.researcherInternalUrl,
      writerUrl: config.writerInternalUrl,
    }) as unknown as DemoAgent;

    const researcherServer = await startAgent(researcher, config.researcherPort);
    const writerServer = await startAgent(writer, config.writerPort);
    const orchestratorServer = await startAgent(orchestrator, config.orchestratorPort);

    const registeredAgents = await Promise.all([
      registryClient.register(config.researcherUrl, researcher.getAgentCard(), {
        ...(config.registryTenantId ? { tenantId: config.registryTenantId } : {}),
      }),
      registryClient.register(config.writerUrl, writer.getAgentCard(), {
        ...(config.registryTenantId ? { tenantId: config.registryTenantId } : {}),
      }),
      registryClient.register(config.orchestratorUrl, orchestrator.getAgentCard(), {
        ...(config.registryTenantId ? { tenantId: config.registryTenantId } : {}),
      }),
    ]);

    await Promise.all(
      registeredAgents.map((agent: { id: string }) => registryClient.sendHeartbeat(agent.id)),
    );

    const heartbeatInterval = setInterval(() => {
      void Promise.allSettled(
        registeredAgents.map((agent: { id: string }) => registryClient.sendHeartbeat(agent.id)),
      );
    }, 15_000);

    let closing = false;
    const closeAll = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      clearInterval(heartbeatInterval);
      researcher.stop();
      writer.stop();
      orchestrator.stop();
      researcherServer.close();
      writerServer.close();
      orchestratorServer.close();
      await shutdown();
      await telemetry.shutdown();
    };

    process.once('SIGINT', closeAll);
    process.once('SIGTERM', closeAll);

    process.stdout.write(
      [
        'a2amesh demo is running.',
        `Registry:      ${config.registryUrl}`,
        `Researcher:    ${config.researcherUrl}`,
        `Writer:        ${config.writerUrl}`,
        `Orchestrator:  ${config.orchestratorUrl}`,
        '',
        'Try it:',
        `curl -X POST ${config.orchestratorUrl}/rpc \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":\\"1\\",\\"method\\":\\"message/send\\",\\"params\\":{\\"message\\":{\\"role\\":\\"user\\",\\"messageId\\":\\"demo-1\\",\\"timestamp\\":\\"2026-04-06T00:00:00.000Z\\",\\"parts\\":[{\\"type\\":\\"text\\",\\"text\\":\\"What is the A2A Protocol?\\"}]}}}"`,
        '',
        'Smoke test:',
        'pnpm run smoke-test',
      ].join('\n') + '\n',
    );
  } catch (error) {
    await telemetry.shutdown();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
