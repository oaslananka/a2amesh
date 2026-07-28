import type { ReactNode } from 'react';
import { AlertTriangle, Eye, KeyRound, Layers3 } from 'lucide-react';
import type { RegistryOperatorContext } from '../api/registry';

interface OperatorContextSummaryProps {
  context: RegistryOperatorContext;
}

function authLabel(context: RegistryOperatorContext): string {
  if (context.accessMode === 'readonly-public') {
    return 'Public discovery only';
  }
  switch (context.authMethod) {
    case 'oidc':
      return 'OIDC authenticated';
    case 'apiKey':
      return 'API key authenticated';
    case 'bearer':
      return 'Bearer authenticated';
    default:
      return 'Anonymous operator access';
  }
}

function visibilityLabel(context: RegistryOperatorContext): string {
  switch (context.visibilityScope) {
    case 'tenant-and-public':
      return 'Tenant and public agents';
    case 'public-and-unassigned':
      return 'Public and unassigned agents';
    case 'public-only':
      return 'Public agents only';
    default:
      return 'All registered agents';
  }
}

export function OperatorContextSummary({ context }: Readonly<OperatorContextSummaryProps>) {
  const staleMinutes = Math.max(1, Math.round(context.healthStaleAfterMs / 60_000));
  const anonymousOperator =
    context.accessMode === 'authenticated' && context.authMethod === 'anonymous';

  return (
    <section
      className="rounded-lg border border-white/10 bg-[#111820] p-4"
      aria-labelledby="operator-context-heading"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Effective context</p>
          <h2 id="operator-context-heading" className="mt-2 text-base font-semibold text-white">
            {authLabel(context)}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <ContextPill
            icon={<KeyRound size={13} />}
            value={context.tenantId ?? 'no tenant claim'}
          />
          <ContextPill icon={<Eye size={13} />} value={visibilityLabel(context)} />
          <ContextPill icon={<Layers3 size={13} />} value={`${staleMinutes}m stale threshold`} />
        </div>
      </div>

      {anonymousOperator ? (
        <p className="mt-3 flex gap-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            The registry control plane is open without an authenticated identity. Tenant isolation
            and attributable operator actions are not enforced in this mode.
          </span>
        </p>
      ) : null}
    </section>
  );
}

interface ContextPillProps {
  icon: ReactNode;
  value: string;
}

function ContextPill({ icon, value }: Readonly<ContextPillProps>) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200">
      {icon}
      {value}
    </span>
  );
}
