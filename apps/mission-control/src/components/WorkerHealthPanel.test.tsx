import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reviewerWorker } from '../test/fixtures';
import { WorkerHealthPanel } from './WorkerHealthPanel';

describe('WorkerHealthPanel', () => {
  it('renders discovered workers with capabilities and concurrency', () => {
    render(<WorkerHealthPanel workers={[reviewerWorker]} loading={false} error={null} />);

    expect(screen.getByText('Reviewer Worker')).toBeTruthy();
    expect(screen.getByText('code-review')).toBeTruthy();
    expect(screen.getByText('0 / 2')).toBeTruthy();
  });

  it('shows an empty state when no workers are discovered', () => {
    render(<WorkerHealthPanel workers={[]} loading={false} error={null} />);
    expect(screen.getByText(/no workers discovered yet/i)).toBeTruthy();
  });

  it('shows a loading state before the first successful fetch', () => {
    render(<WorkerHealthPanel workers={[]} loading={true} error={null} />);
    expect(screen.getByText(/loading worker health/i)).toBeTruthy();
  });

  it('shows an error state when the initial fetch fails', () => {
    render(<WorkerHealthPanel workers={[]} loading={false} error="registry unreachable" />);
    expect(screen.getByText('registry unreachable')).toBeTruthy();
  });
});
