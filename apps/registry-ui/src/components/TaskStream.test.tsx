import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { completedTask, workingTask } from '../test/fixtures';
import { TaskStream } from './TaskStream';

describe('TaskStream', () => {
  it('renders the loading and retrying states while task activity is pending', () => {
    render(<TaskStream tasks={[]} loading error={null} connected={false} />);

    expect(screen.getByText('Loading task activity...')).toBeTruthy();
    expect(screen.getByText('Retrying')).toBeTruthy();
  });

  it('renders API errors without requiring task rows', () => {
    render(
      <TaskStream tasks={[]} loading={false} error="Task stream error: 503" connected={false} />,
    );

    expect(screen.getByText('Task stream error: 503')).toBeTruthy();
    expect(screen.getByText('No recent task activity yet.')).toBeTruthy();
  });

  it('renders an empty state after loading completes with no events', () => {
    render(<TaskStream tasks={[]} loading={false} error={null} connected />);

    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('No recent task activity yet.')).toBeTruthy();
  });

  it('renders task rows and filters them by selected agent', () => {
    render(
      <TaskStream
        tasks={[completedTask, workingTask]}
        loading={false}
        error={null}
        connected
        selectedAgentId={workingTask.agentId}
      />,
    );

    expect(screen.getByText('Drafting final report from research output.')).toBeTruthy();
    expect(screen.queryByText('Collected and summarized research findings.')).toBeNull();
    expect(screen.getByText('WORKING')).toBeTruthy();
    expect(screen.getByText('4 messages')).toBeTruthy();
    expect(screen.getByText('0 artifacts')).toBeTruthy();
  });
});
