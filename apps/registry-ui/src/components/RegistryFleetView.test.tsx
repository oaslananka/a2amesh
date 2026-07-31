import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { completedTask, researcherAgent, workingTask, writerAgent } from '../test/fixtures';
import { RegistryFleetView } from './RegistryFleetView';

describe('RegistryFleetView', () => {
  it('renders fleet health, trust, task counts, and selection', () => {
    const onSelectAgent = vi.fn();
    render(
      <RegistryFleetView
        agents={[researcherAgent, writerAgent]}
        tasks={[completedTask, workingTask]}
        loading={false}
        error={null}
        selectedAgentId={researcherAgent.id}
        healthStaleAfterMs={60_000}
        taskStreamConnected
        onSelectAgent={onSelectAgent}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Fleet table' })).toBeTruthy();
    expect(screen.getByText('2 visible agents, 2 recent task events')).toBeTruthy();
    expect(screen.getByText('Live task feed connected')).toBeTruthy();
    expect(screen.getByText('Researcher Agent')).toBeTruthy();
    expect(screen.getByText('Writer Agent')).toBeTruthy();
    expect(screen.getByText('1 active')).toBeTruthy();
    expect(screen.getByText('Trusted Agent Card')).toBeTruthy();

    const scrollRegion = screen.getByLabelText('Fleet table scroll area');
    const scrollBy = vi.fn();
    Object.defineProperty(scrollRegion, 'clientWidth', { configurable: true, value: 600 });
    Object.defineProperty(scrollRegion, 'scrollBy', { configurable: true, value: scrollBy });
    fireEvent.click(screen.getByRole('button', { name: 'Scroll fleet table right' }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });

    fireEvent.click(screen.getByText('Writer Agent'));
    expect(onSelectAgent).toHaveBeenCalledWith(writerAgent);
  });

  it('renders loading, error, and empty states', () => {
    const props = {
      agents: [],
      tasks: [],
      selectedAgentId: null,
      healthStaleAfterMs: 60_000,
      taskStreamConnected: false,
      onSelectAgent: vi.fn(),
    } as const;

    const { rerender } = render(<RegistryFleetView {...props} loading error={null} />);
    expect(screen.getByText('Loading fleet')).toBeTruthy();

    rerender(<RegistryFleetView {...props} loading={false} error="Registry offline" />);
    expect(screen.getByText('Registry unavailable')).toBeTruthy();
    expect(screen.getByText('Registry offline')).toBeTruthy();

    rerender(<RegistryFleetView {...props} loading={false} error={null} />);
    expect(screen.getByText('No matching agents')).toBeTruthy();
  });
});
