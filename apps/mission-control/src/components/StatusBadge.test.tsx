import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['IDLE', 'Idle'],
    ['RUNNING', 'Running'],
    ['PENDING', 'Pending'],
    ['COMPLETED', 'Completed'],
    ['FAILED', 'Failed'],
    ['NOT_REQUIRED', 'Not Required'],
  ])('renders a human-readable label for %s', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('falls back to the NOT_REQUIRED treatment for an unrecognized status', () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText('Something New')).toBeTruthy();
  });
});
