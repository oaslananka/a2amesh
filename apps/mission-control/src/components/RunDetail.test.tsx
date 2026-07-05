import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../test/test-utils';
import { auditEntries, planArtifact } from '../test/fixtures';
import { RunDetail } from './RunDetail';

describe('RunDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prompts for a selection when no run is chosen', () => {
    render(<RunDetail runId={null} />);
    expect(screen.getByText(/select a run/i)).toBeTruthy();
  });

  it('loads and displays artifacts and the audit timeline for the selected run', async () => {
    installFetchMock([
      { path: '/api/fleet/runs/run-1/artifacts', body: [planArtifact] },
      { path: '/api/fleet/audit?runId=run-1', body: auditEntries },
    ]);

    render(<RunDetail runId="run-1" />);

    await waitFor(() => expect(screen.getByText('artifact-1')).toBeTruthy());
    expect(screen.getByText('plan')).toBeTruthy();
    expect(screen.getByText('Plan: review the diff.')).toBeTruthy();
    expect(screen.getByText('task-routed')).toBeTruthy();
    expect(screen.getByText('run-completed')).toBeTruthy();
  });
});
