import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../test/test-utils';
import { runningRun } from '../test/fixtures';
import { RoutingPanel } from './RoutingPanel';

describe('RoutingPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes a task and displays the resulting decision and run', async () => {
    installFetchMock([
      {
        method: 'POST',
        path: '/api/fleet/tasks/route',
        body: {
          decision: {
            taskId: 'task-1',
            selectedWorkerId: 'worker-1',
            candidateWorkerIds: ['worker-1'],
            signals: ['capability'],
            reason: 'selected by capability match',
            decidedAt: '2026-07-05T00:00:00.000Z',
          },
          run: runningRun,
        },
      },
    ]);
    const onRouted = vi.fn();

    render(<RoutingPanel onRouted={onRouted} />);

    fireEvent.change(screen.getByLabelText(/task id/i), { target: { value: 'task-1' } });
    fireEvent.click(screen.getByRole('button', { name: /route task/i }));

    await waitFor(() => expect(screen.getByText('selected by capability match')).toBeTruthy());
    expect(screen.getByText(/RUNNING \/ NOT_REQUIRED/)).toBeTruthy();
    expect(onRouted).toHaveBeenCalledTimes(1);
  });

  it('reports when no worker is selected', async () => {
    installFetchMock([
      {
        method: 'POST',
        path: '/api/fleet/tasks/route',
        body: {
          decision: {
            taskId: 'task-1',
            candidateWorkerIds: [],
            signals: ['capability'],
            reason: 'no eligible worker available',
            decidedAt: '2026-07-05T00:00:00.000Z',
          },
          run: null,
        },
      },
    ]);

    render(<RoutingPanel onRouted={() => {}} />);
    fireEvent.change(screen.getByLabelText(/task id/i), { target: { value: 'task-1' } });
    fireEvent.click(screen.getByRole('button', { name: /route task/i }));

    await waitFor(() => expect(screen.getByText(/no worker was selected/i)).toBeTruthy());
  });
});
