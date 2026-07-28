import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  completedTask,
  failedTask,
  publicAgent,
  researcherAgent,
  workingTask,
  writerAgent,
} from '../test/fixtures';
import { ConformanceDashboard } from './ConformanceDashboard';

describe('ConformanceDashboard', () => {
  it('summarizes fleet-level operation coverage', () => {
    render(
      <ConformanceDashboard
        agents={[researcherAgent, writerAgent, publicAgent]}
        tasks={[completedTask, workingTask, failedTask]}
        selectedAgent={researcherAgent}
      />,
    );

    expect(screen.getByText('A2A compliance dashboard')).toBeTruthy();
    expect(screen.getByText('Send ready')).toBeTruthy();
    expect(screen.getByText('Streaming')).toBeTruthy();
    expect(screen.getByText('Push')).toBeTruthy();
    expect(screen.getByText('MCP')).toBeTruthy();
    expect(screen.getByText('Task events')).toBeTruthy();
    expect(
      screen.getByText('Researcher Agent · https://registry.example/agents/researcher'),
    ).toBeTruthy();
  });

  it('marks a fully observed agent as a release candidate with partial optional gaps', () => {
    render(
      <ConformanceDashboard
        agents={[researcherAgent]}
        tasks={[completedTask]}
        selectedAgent={researcherAgent}
      />,
    );

    expect(screen.getByText('release candidate')).toBeTruthy();
    expect(screen.getByText('Agent Card metadata')).toBeTruthy();
    expect(screen.getByText('Agent Card trust')).toBeTruthy();
    expect(screen.getByText(/tenant-a-key/)).toBeTruthy();
    expect(screen.getByText('message/stream capability')).toBeTruthy();
    expect(screen.getByText('Task read model')).toBeTruthy();
    expect(screen.getByText('Artifact surface')).toBeTruthy();
    expect(screen.getByText(/artifactCount > 0/)).toBeTruthy();
  });

  it('surfaces missing terminal success evidence for unhealthy or incomplete agents', () => {
    render(
      <ConformanceDashboard
        agents={[writerAgent]}
        tasks={[workingTask, failedTask]}
        selectedAgent={writerAgent}
      />,
    );

    expect(screen.getByText('needs evidence')).toBeTruthy();
    expect(screen.getByText('Writer Agent · https://registry.example/agents/writer')).toBeTruthy();

    const trustCard = screen.getByText('Agent Card trust').closest('article');
    expect(trustCard).not.toBeNull();
    expect(within(trustCard as HTMLElement).getByText('partial')).toBeTruthy();

    const terminalCard = screen.getByText('Terminal state coverage').closest('article');
    expect(terminalCard).not.toBeNull();
    expect(within(terminalCard as HTMLElement).getByText('fail')).toBeTruthy();
    expect(screen.getByText(/latest task-failed-003 on Writer Agent/)).toBeTruthy();
  });
});
