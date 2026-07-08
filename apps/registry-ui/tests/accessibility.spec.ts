import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

function formatViolations(violations: AxeViolation[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => node.target.join(' '))
        .filter(Boolean)
        .join(', ');
      return `${violation.impact ?? 'unknown'} ${violation.id}: ${violation.help} (${targets})`;
    })
    .join('\n');
}

function installMockEventSource(page: Page) {
  return page.addInitScript(() => {
    class MockEventSource {
      url: string;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          if (this.url.includes('/tasks/stream')) {
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({
                  taskId: 'task-2',
                  agentId: 'agent-2',
                  agentName: 'Writer Agent',
                  agentUrl: 'http://localhost:3002',
                  status: 'working',
                  updatedAt: '2026-04-06T10:00:03.000Z',
                  summary: 'Drafting final report from research output.',
                  historyCount: 4,
                  artifactCount: 0,
                  task: {
                    id: 'task-2',
                    status: { state: 'WORKING', timestamp: '2026-04-06T10:00:03.000Z' },
                  },
                }),
              }),
            );
          } else {
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({
                  id: 'agent-1',
                  url: 'http://localhost:3001',
                  status: 'healthy',
                  tenantId: 'tenant-a',
                  card: {
                    name: 'Researcher Agent',
                    description: 'Finds and synthesizes information.',
                    version: '1.0.0',
                    transport: 'http',
                    capabilities: { streaming: true, mcpCompatible: true },
                    skills: [
                      {
                        id: 'research',
                        name: 'Research',
                        description: 'Researches topics',
                        tags: ['web'],
                      },
                    ],
                  },
                }),
              }),
            );
          }
        }, 50);
      }

      close() {}
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
}

async function routeAuthenticatedDashboard(page: Page) {
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'agent-1',
          url: 'http://localhost:3001',
          status: 'healthy',
          tenantId: 'tenant-a',
          lastHeartbeatAt: '2026-04-06T10:04:00.000Z',
          lastSuccessAt: '2026-04-06T10:02:00.000Z',
          card: {
            name: 'Researcher Agent',
            description: 'Finds and synthesizes information.',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true, mcpCompatible: true },
            skills: [
              {
                id: 'research',
                name: 'Research',
                description: 'Researches topics',
                tags: ['web'],
              },
            ],
          },
        },
        {
          id: 'agent-2',
          url: 'http://localhost:3002',
          status: 'unhealthy',
          tenantId: 'tenant-a',
          consecutiveFailures: 2,
          card: {
            name: 'Writer Agent',
            description: 'Polishes output into a report.',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true },
            skills: [
              {
                id: 'write',
                name: 'Write',
                description: 'Creates polished output',
                tags: ['text'],
              },
            ],
          },
        },
      ]),
    });
  });

  await page.route('**/api/metrics/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        registrations: 12,
        searches: 8,
        heartbeats: 42,
        agentCount: 2,
        healthyAgents: 1,
        unhealthyAgents: 1,
        unknownAgents: 0,
        activeTenants: 1,
        publicAgents: 0,
      }),
    });
  });

  await page.route('**/api/tasks/recent?limit=30', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          taskId: 'task-1',
          agentId: 'agent-1',
          agentName: 'Researcher Agent',
          agentUrl: 'http://localhost:3001',
          status: 'completed',
          updatedAt: '2026-04-06T10:00:00.000Z',
          summary: 'Collected and summarized research findings.',
          historyCount: 3,
          artifactCount: 1,
          task: {
            id: 'task-1',
            status: { state: 'COMPLETED', timestamp: '2026-04-06T10:00:00.000Z' },
          },
        },
      ]),
    });
  });

  await installMockEventSource(page);
}

test('dashboard has no critical or serious accessibility violations', async ({ page }) => {
  await routeAuthenticatedDashboard(page);

  await page.goto('/');

  await expect(page.getByText('Operator mode')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Researcher Agent' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Writer Agent/ })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );

  expect(blockingViolations, formatViolations(blockingViolations)).toEqual([]);
});

test('register agent panel has no critical or serious accessibility violations', async ({
  page,
}) => {
  await routeAuthenticatedDashboard(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: 'Register a new agent' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );

  expect(blockingViolations, formatViolations(blockingViolations)).toEqual([]);
});
