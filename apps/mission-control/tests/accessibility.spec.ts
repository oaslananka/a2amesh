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
      close() {}
      addEventListener() {}
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
}

async function routeMissionControlDashboard(page: Page) {
  await page.route('**/api/fleet/workers', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          workerId: 'worker-1',
          name: 'Reviewer Worker',
          status: 'IDLE',
          capabilities: ['code-review'],
          roles: ['reviewer'],
          lastHeartbeatAt: '2026-07-05T00:00:00.000Z',
          activeRunCount: 0,
          maxConcurrentTasks: 2,
        },
      ]),
    });
  });

  const run = {
    id: 'run-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    status: 'PENDING',
    approvalState: 'PENDING',
    riskLevel: 'publish',
    routingDecision: {
      taskId: 'task-1',
      selectedWorkerId: 'worker-1',
      candidateWorkerIds: ['worker-1'],
      signals: ['capability'],
      reason: 'selected by capability match',
      decidedAt: '2026-07-05T00:00:00.000Z',
    },
    artifacts: [],
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };

  await page.route('**/api/fleet/runs', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([run]) });
  });

  await installMockEventSource(page);
}

test('dashboard has no critical or serious accessibility violations', async ({ page }) => {
  await routeMissionControlDashboard(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
  await expect(page.getByText('Reviewer Worker')).toBeVisible();
  await expect(page.getByText('task-1')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );

  expect(blockingViolations, formatViolations(blockingViolations)).toEqual([]);
});
