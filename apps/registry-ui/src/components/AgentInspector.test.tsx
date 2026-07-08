import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failedTask, writerAgent } from '../test/fixtures';
import { installFetchMock } from '../test/test-utils';
import { AgentInspector } from './AgentInspector';

function formatRelativeTime(timestamp?: string) {
  return timestamp ? 'recently' : 'Never';
}

describe('AgentInspector', () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText },
    });
  });

  afterEach(() => {
    writeText.mockClear();
    vi.unstubAllGlobals();
  });

  it('renders health reasons, remediation hints, visibility, and quick actions', () => {
    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Writer Agent' })).toBeTruthy();
    expect(screen.getByText('private agent')).toBeTruthy();
    expect(screen.getByText('tenant: tenant-a')).toBeTruthy();
    expect(screen.getByText('operator actions enabled')).toBeTruthy();
    expect(screen.getByText(/Provider timeout while drafting reports/)).toBeTruthy();
    expect(screen.getByText(/Check OpenAI\/Anthropic provider latency/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export config' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replay latest' })).toBeTruthy();
  });

  it('copies the agent card and exported config to the clipboard', async () => {
    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy card' }));
    await waitFor(() => expect(screen.getByText('Agent card copied.')).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Writer Agent'));

    fireEvent.click(screen.getByRole('button', { name: 'Export config' }));
    await waitFor(() => expect(screen.getByText('Agent config exported.')).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('"visibility": "private"'));
  });

  it('prepares replay context for the latest task event', () => {
    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Replay latest' }));

    expect(screen.getByText(`Replay prepared for ${failedTask.taskId}.`)).toBeTruthy();
  });

  it('hides the delete action in readonly-public mode', () => {
    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="readonly-public"
        formatRelativeTime={formatRelativeTime}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Delete agent' })).toBeNull();
  });

  it('requires a second click to confirm deletion, and deletes on confirm', async () => {
    const { fetchMock } = installFetchMock([
      { path: `/api/agents/${writerAgent.id}`, status: 204 },
    ]);
    const onDeleted = vi.fn();

    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
    expect(screen.getByRole('button', { name: 'Confirm delete agent' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete agent' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(writerAgent.id));
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/agents/${writerAgent.id}`);
    expect(init.method).toBe('DELETE');
  });

  it('cancels the delete confirmation without calling the registry', () => {
    const { fetchMock } = installFetchMock([
      { path: `/api/agents/${writerAgent.id}`, status: 204 },
    ]);

    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Delete agent' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a registry error and resets confirmation when deletion fails', async () => {
    installFetchMock([
      {
        path: `/api/agents/${writerAgent.id}`,
        status: 403,
        body: { detail: 'Forbidden' },
      },
    ]);
    const onDeleted = vi.fn();

    render(
      <AgentInspector
        selectedAgent={writerAgent}
        selectedAgentTasks={[failedTask]}
        accessMode="authenticated"
        formatRelativeTime={formatRelativeTime}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete agent' }));

    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete agent' })).toBeTruthy();
  });
});
