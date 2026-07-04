import { AlertTriangle, CheckCircle2, KeyRound, Lock, Network } from 'lucide-react';
import { useMemo } from 'react';
import type { RegisteredAgent, RegistryAccessMode, RegistryTaskEvent } from '../api/registry';

interface EnterpriseControlsPanelProps {
  agents: RegisteredAgent[];
  tasks: RegistryTaskEvent[];
  accessMode: RegistryAccessMode;
}

type ControlStatus = 'pass' | 'watch' | 'block';

interface ControlItem {
  id: string;
  label: string;
  description: string;
  status: ControlStatus;
  evidence: string;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function statusClasses(status: ControlStatus): string {
  if (status === 'pass') {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
  }
  if (status === 'block') {
    return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
  }
  return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
}

function StatusIcon({ status }: { status: ControlStatus }) {
  if (status === 'pass') {
    return <CheckCircle2 size={18} className="text-emerald-200" aria-hidden="true" />;
  }
  if (status === 'block') {
    return <AlertTriangle size={18} className="text-rose-200" aria-hidden="true" />;
  }
  return <AlertTriangle size={18} className="text-amber-200" aria-hidden="true" />;
}

function summarizeControls(
  agents: RegisteredAgent[],
  tasks: RegistryTaskEvent[],
  accessMode: RegistryAccessMode,
): ControlItem[] {
  const tenantIds = new Set(agents.map((agent) => agent.tenantId).filter(Boolean));
  const publicAgents = agents.filter((agent) => agent.isPublic);
  const privateAgents = agents.filter((agent) => !agent.isPublic);
  const unhealthyAgents = agents.filter((agent) => agent.status === 'unhealthy');
  const pushAgents = agents.filter((agent) => agent.card.capabilities?.pushNotifications);
  const taskFailures = tasks.filter((task) => ['FAILED', 'CANCELED'].includes(task.status));
  const externalWaits = tasks.filter((task) => task.status === 'WAITING_ON_EXTERNAL');

  return [
    {
      id: 'access-mode',
      label: 'Registry access mode',
      description:
        'Operator consoles should clearly show whether the registry is authenticated or public-readonly.',
      status: accessMode === 'authenticated' ? 'pass' : 'watch',
      evidence:
        accessMode === 'authenticated'
          ? 'Authenticated registry session is active.'
          : 'Public readonly mode is active; write actions should remain disabled.',
    },
    {
      id: 'tenant-isolation',
      label: 'Tenant isolation',
      description: 'Agents should carry tenant metadata before production routing is enabled.',
      status: tenantIds.size > 0 && tenantIds.size === agents.length ? 'pass' : 'watch',
      evidence: `${tenantIds.size}/${agents.length} registered agents expose tenant ids.`,
    },
    {
      id: 'public-exposure',
      label: 'Public exposure review',
      description:
        'Public agents should be easy to review separately from private or tenant-scoped agents.',
      status: publicAgents.length === 0 || privateAgents.length > 0 ? 'pass' : 'watch',
      evidence: `${publicAgents.length} public agent(s), ${privateAgents.length} private/tenant-scoped agent(s).`,
    },
    {
      id: 'callback-surface',
      label: 'Callback surface',
      description:
        'Push-capable agents should be visible for callback allowlist and webhook review.',
      status: pushAgents.length > 0 ? 'watch' : 'pass',
      evidence:
        pushAgents.length > 0
          ? `${pushAgents.length} agent(s) advertise push notification callbacks.`
          : 'No push callback capable agent is currently advertised.',
    },
    {
      id: 'health-gate',
      label: 'Health promotion gate',
      description:
        'Unhealthy agents should block production promotion until remediation is recorded.',
      status: unhealthyAgents.length > 0 ? 'block' : 'pass',
      evidence:
        unhealthyAgents.length > 0
          ? `${unhealthyAgents.length} unhealthy agent(s) need remediation before promotion.`
          : 'No unhealthy agents are currently registered.',
    },
    {
      id: 'task-risk',
      label: 'Task failure watch',
      description:
        'Failed, canceled, or externally waiting tasks should be visible in the operator checklist.',
      status: taskFailures.length > 0 ? 'block' : externalWaits.length > 0 ? 'watch' : 'pass',
      evidence: `${taskFailures.length} terminal failure(s), ${externalWaits.length} waiting-on-external task(s).`,
    },
  ];
}

export function EnterpriseControlsPanel({
  agents,
  tasks,
  accessMode,
}: EnterpriseControlsPanelProps) {
  const controls = useMemo(
    () => summarizeControls(agents, tasks, accessMode),
    [agents, tasks, accessMode],
  );
  const passCount = controls.filter((control) => control.status === 'pass').length;
  const watchCount = controls.filter((control) => control.status === 'watch').length;
  const blockCount = controls.filter((control) => control.status === 'block').length;
  const promoteReady = blockCount === 0;

  return (
    <section className="rounded-lg border border-cyan-300/15 bg-[#111820] p-5">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-cyan-200">Controls</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Enterprise policy console</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Review tenant coverage, public exposure, callback-capable agents, health gates, and task
            risk before routing production traffic.
          </p>
        </div>
        <div
          className={classNames(
            'rounded-2xl border px-4 py-3 text-center',
            promoteReady
              ? 'border-emerald-300/20 bg-emerald-300/10'
              : 'border-rose-300/20 bg-rose-300/10',
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-200">Promotion gate</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {promoteReady ? 'ready' : 'blocked'}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {passCount} pass · {watchCount} watch · {blockCount} block
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Lock size={18} />}
          label="Tenants"
          value={new Set(agents.map((agent) => agent.tenantId).filter(Boolean)).size}
        />
        <MetricCard
          icon={<Network size={18} />}
          label="Public agents"
          value={agents.filter((agent) => agent.isPublic).length}
        />
        <MetricCard
          icon={<KeyRound size={18} />}
          label="Callback-capable"
          value={agents.filter((agent) => agent.card.capabilities?.pushNotifications).length}
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {controls.map((control) => (
          <article
            key={control.id}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
          >
            <div className="flex items-start gap-3">
              <StatusIcon status={control.status} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{control.label}</h3>
                  <span
                    className={classNames(
                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]',
                      statusClasses(control.status),
                    )}
                  >
                    {control.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{control.description}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Evidence: {control.evidence}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center gap-2 text-cyan-100">
        {icon}
        <p className="text-[11px] uppercase tracking-[0.22em]">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
