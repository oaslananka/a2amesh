import { expect, test, type Page } from '@playwright/test';

function installMockEventSource(page: Page) {
  return page.addInitScript(() => {
    class MockEventSource {
      url: string;
      listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
      }

      addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
        const handlers = this.listeners.get(type) ?? [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }

      close() {}
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
}

test('routes a task and shows the resulting run', async ({ page }) => {
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

  await page.route('**/api/fleet/runs', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: '[]' });
      return;
    }
    await route.continue();
  });

  const routingDecision = {
    taskId: 'task-1',
    selectedWorkerId: 'worker-1',
    candidateWorkerIds: ['worker-1'],
    signals: ['capability'],
    reason: 'selected by capability match, load, and deterministic tie-break',
    decidedAt: '2026-07-05T00:00:00.000Z',
  };
  const run = {
    id: 'run-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    status: 'RUNNING',
    approvalState: 'NOT_REQUIRED',
    routingDecision,
    artifacts: [],
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };

  await page.route('**/api/fleet/tasks/route', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ decision: routingDecision, run }),
    });
  });

  await installMockEventSource(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
  await expect(page.getByText('Reviewer Worker')).toBeVisible();

  await page.getByLabel('Task ID').fill('task-1');
  await page.getByRole('button', { name: 'Route task' }).click();

  await expect(
    page.getByText('selected by capability match, load, and deterministic tie-break'),
  ).toBeVisible();
});
