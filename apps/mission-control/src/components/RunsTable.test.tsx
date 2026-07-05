import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../test/test-utils';
import { pendingRun, runningRun } from '../test/fixtures';
import { RunsTable } from './RunsTable';

describe('RunsTable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders runs with task, worker, status, and approval state', () => {
    render(
      <RunsTable
        runs={[runningRun]}
        loading={false}
        error={null}
        selectedRunId={null}
        onSelect={() => {}}
        onChanged={() => {}}
      />,
    );

    expect(screen.getByText('task-1')).toBeTruthy();
    expect(screen.getByText('worker-1')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Not Required')).toBeTruthy();
  });

  it('only shows approve/reject actions for runs pending approval', () => {
    render(
      <RunsTable
        runs={[runningRun, pendingRun]}
        loading={false}
        error={null}
        selectedRunId={null}
        onSelect={() => {}}
        onChanged={() => {}}
      />,
    );

    expect(screen.getAllByLabelText(/approve run/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/reject run/i)).toHaveLength(1);
  });

  it('calls the approve endpoint and reports the change when approved', async () => {
    const { calls } = installFetchMock([
      {
        method: 'POST',
        path: '/api/fleet/runs/run-2/approve',
        body: { ...pendingRun, status: 'RUNNING' },
      },
    ]);
    const onChanged = vi.fn();

    render(
      <RunsTable
        runs={[pendingRun]}
        loading={false}
        error={null}
        selectedRunId={null}
        onSelect={() => {}}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByLabelText(/approve run/i));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toContain('POST /api/fleet/runs/run-2/approve');
  });

  it('selects a run when its row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <RunsTable
        runs={[runningRun]}
        loading={false}
        error={null}
        selectedRunId={null}
        onSelect={onSelect}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('task-1'));
    expect(onSelect).toHaveBeenCalledWith('run-1');
  });
});
