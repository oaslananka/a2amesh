import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { completedTask, researcherAgent, workingTask, writerAgent } from '../test/fixtures';
import { RegistryActivitySummary } from './RegistryActivitySummary';

const formatRelativeTime = () => 'recently';

describe('RegistryActivitySummary', () => {
  it('shows the selected agent task window', () => {
    render(
      <RegistryActivitySummary
        tasks={[completedTask, workingTask]}
        selectedAgent={writerAgent}
        selectedAgentTasks={[workingTask]}
        loading={false}
        error={null}
        formatRelativeTime={formatRelativeTime}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Task summary' })).toBeTruthy();
    expect(screen.getByText('1 events')).toBeTruthy();
    expect(screen.getByText(workingTask.summary ?? '')).toBeTruthy();
    expect(screen.queryByText(completedTask.summary ?? '')).toBeNull();
  });

  it('shows fleet activity when no agent is selected', () => {
    render(
      <RegistryActivitySummary
        tasks={[completedTask, workingTask]}
        selectedAgent={null}
        selectedAgentTasks={[]}
        loading={false}
        error={null}
        formatRelativeTime={formatRelativeTime}
      />,
    );

    expect(screen.getByText('2 events')).toBeTruthy();
    expect(screen.getByText(researcherAgent.card.name)).toBeTruthy();
    expect(screen.getByText(writerAgent.card.name)).toBeTruthy();
  });

  it('renders loading, error, and empty states', () => {
    const baseProps = {
      tasks: [],
      selectedAgent: null,
      selectedAgentTasks: [],
      formatRelativeTime,
    } as const;

    const { rerender } = render(<RegistryActivitySummary {...baseProps} loading error={null} />);
    expect(screen.getByText('Loading task activity…')).toBeTruthy();

    rerender(
      <RegistryActivitySummary {...baseProps} loading={false} error="Task stream unavailable" />,
    );
    expect(screen.getByText('Task stream unavailable')).toBeTruthy();

    rerender(<RegistryActivitySummary {...baseProps} loading={false} error={null} />);
    expect(screen.getByText('No recent tasks')).toBeTruthy();
  });
});
