import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../test/test-utils';
import { RegisterAgentPanel } from './RegisterAgentPanel';

function fillRequiredFields() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Agent URL' }), {
    target: { value: 'http://localhost:4001' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'New Agent' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
    target: { value: 'A new agent.' },
  });
}

describe('RegisterAgentPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a locked message and no form in readonly-public mode', () => {
    render(<RegisterAgentPanel accessMode="readonly-public" onRegistered={vi.fn()} />);

    expect(screen.getByText('Registering agents requires operator authentication.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register agent' })).toBeNull();
  });

  it('disables submit until the required fields are filled', () => {
    render(<RegisterAgentPanel accessMode="authenticated" onRegistered={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Register agent' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fillRequiredFields();

    expect(submit.disabled).toBe(false);
  });

  it('registers an agent and reports the result back to the caller', async () => {
    const registered = {
      id: 'agent-new',
      url: 'http://localhost:4001',
      status: 'unknown',
      card: { name: 'New Agent', description: 'A new agent.', version: '1.0.0' },
    };
    installFetchMock([{ path: '/api/agents/register', status: 201, body: registered }]);
    const onRegistered = vi.fn();

    render(<RegisterAgentPanel accessMode="authenticated" onRegistered={onRegistered} />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Register agent' }));

    await waitFor(() => expect(screen.getByText('Registered New Agent.')).toBeTruthy());
    expect(onRegistered).toHaveBeenCalledWith(registered);

    const agentUrlInput = screen.getByRole('textbox', { name: 'Agent URL' }) as HTMLInputElement;
    expect(agentUrlInput.value).toBe('');
  });

  it('shows the registry error message when registration fails', async () => {
    installFetchMock([
      {
        path: '/api/agents/register',
        status: 400,
        body: { detail: 'Invalid agentUrl: private network blocked' },
      },
    ]);

    render(<RegisterAgentPanel accessMode="authenticated" onRegistered={vi.fn()} />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Register agent' }));

    await waitFor(() =>
      expect(screen.getByText('Invalid agentUrl: private network blocked')).toBeTruthy(),
    );
  });
});
