import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperatorContextSummary } from './OperatorContextSummary';

describe('OperatorContextSummary', () => {
  it('shows authenticated tenant scope without exposing claims or credentials', () => {
    render(
      <OperatorContextSummary
        context={{
          accessMode: 'authenticated',
          authMethod: 'oidc',
          tenantId: 'tenant-a',
          visibilityScope: 'tenant-and-public',
          healthStaleAfterMs: 240_000,
        }}
      />,
    );

    expect(screen.getByText('OIDC authenticated')).toBeTruthy();
    expect(screen.getByText('tenant-a')).toBeTruthy();
    expect(screen.getByText('Tenant and public agents')).toBeTruthy();
    expect(screen.getByText('4m stale threshold')).toBeTruthy();
  });

  it('warns when operator access is anonymous and distinguishes public discovery', () => {
    const { rerender } = render(
      <OperatorContextSummary
        context={{
          accessMode: 'authenticated',
          authMethod: 'anonymous',
          tenantId: null,
          visibilityScope: 'all',
          healthStaleAfterMs: 240_000,
        }}
      />,
    );

    expect(screen.getByText('Anonymous operator access')).toBeTruthy();
    expect(
      screen.getByText(/control plane is open without an authenticated identity/i),
    ).toBeTruthy();

    rerender(
      <OperatorContextSummary
        context={{
          accessMode: 'readonly-public',
          authMethod: 'anonymous',
          tenantId: null,
          visibilityScope: 'public-only',
          healthStaleAfterMs: 240_000,
        }}
      />,
    );

    expect(screen.getByText('Public discovery only')).toBeTruthy();
    expect(screen.getByText('Public agents only')).toBeTruthy();
  });
});
