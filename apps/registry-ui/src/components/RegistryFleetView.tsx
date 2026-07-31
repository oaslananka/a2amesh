import { useRef } from 'react';
import { Activity, AlertTriangle, Bot, Workflow } from 'lucide-react';
import { describeAgentFreshness, describeAgentTrust } from '../agentPresentation';
import type { RegisteredAgent, RegistryTaskEvent } from '../api/registry';
import { countActiveRegistryTasks, formatRelativeTime } from '../registryDashboardModel';
import { HealthBadge } from './HealthBadge';

interface RegistryFleetViewProps {
  agents: readonly RegisteredAgent[];
  tasks: readonly RegistryTaskEvent[];
  loading: boolean;
  error: string | null;
  selectedAgentId: string | null;
  healthStaleAfterMs: number;
  taskStreamConnected: boolean;
  onSelectAgent: (agent: RegisteredAgent) => void;
}

type FleetTableProps = Pick<
  RegistryFleetViewProps,
  'agents' | 'tasks' | 'selectedAgentId' | 'healthStaleAfterMs' | 'onSelectAgent'
>;

type FleetContentProps = Pick<
  RegistryFleetViewProps,
  | 'agents'
  | 'tasks'
  | 'loading'
  | 'error'
  | 'selectedAgentId'
  | 'healthStaleAfterMs'
  | 'onSelectAgent'
>;

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function agentSignalClasses(state: string): string {
  if (state === 'trusted') {
    return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100';
  }
  if (state === 'rejected') {
    return 'border-rose-300/25 bg-rose-300/10 text-rose-100';
  }
  return 'border-amber-300/25 bg-amber-300/10 text-amber-100';
}

function AgentSignal({
  label,
  state,
  detail,
}: Readonly<{ label: string; state: string; detail: string }>) {
  return (
    <div className="min-w-40">
      <span
        className={classNames(
          'inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
          agentSignalClasses(state),
        )}
      >
        {label}
      </span>
      <span className="mt-1 block text-xs text-slate-400">{detail}</span>
    </div>
  );
}

function EmptyState({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-slate-400">
      <Activity size={24} className="mb-3 text-slate-500" />
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6">{body}</p>
    </div>
  );
}

function ErrorState({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div className="border border-rose-400/20 bg-rose-400/10 px-6 py-16 text-center text-rose-100">
      <div className="flex items-center justify-center gap-2">
        <AlertTriangle size={16} />
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-rose-100/85">{body}</p>
    </div>
  );
}

function FleetTable({
  agents,
  tasks,
  selectedAgentId,
  healthStaleAfterMs,
  onSelectAgent,
}: Readonly<FleetTableProps>) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const scrollTable = (direction: -1 | 1) => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      return;
    }

    const distance = Math.max(scrollRegion.clientWidth / 2, 160);
    scrollRegion.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  return (
    <div ref={scrollRegionRef} className="overflow-x-auto" aria-label="Fleet table scroll area">
      <div className="sr-only focus-within:not-sr-only focus-within:flex focus-within:gap-2 focus-within:p-2">
        <button type="button" onClick={() => scrollTable(-1)}>
          Scroll fleet table left
        </button>
        <button type="button" onClick={() => scrollTable(1)}>
          Scroll fleet table right
        </button>
      </div>
      <table className="min-w-full divide-y divide-white/8 text-sm">
        <thead className="bg-white/4 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
          <tr>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Trust & freshness</th>
            <th className="px-4 py-3">Tenant</th>
            <th className="px-4 py-3">Transport</th>
            <th className="px-4 py-3">Last success</th>
            <th className="px-4 py-3">Heartbeat drift</th>
            <th className="px-4 py-3">Recent tasks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {agents.map((agent) => {
            const agentTasks = tasks.filter((task) => task.agentId === agent.id);
            const trust = describeAgentTrust(agent);
            const freshness = describeAgentFreshness(agent, healthStaleAfterMs);
            const activeTasks = countActiveRegistryTasks(agentTasks);
            return (
              <tr
                key={agent.id}
                className={classNames(
                  'cursor-pointer transition hover:bg-white/4',
                  selectedAgentId === agent.id && 'bg-cyan-300/8',
                )}
                onClick={() => onSelectAgent(agent)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-md border border-white/10 bg-white/5 p-2">
                      <Bot size={16} className="text-cyan-200" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{agent.card.name}</span>
                        {agent.isPublic ? (
                          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100">
                            public
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                        {agent.card.description}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <HealthBadge status={agent.status} />
                </td>
                <td className="px-4 py-3">
                  <AgentSignal label={trust.label} state={trust.state} detail={freshness.label} />
                </td>
                <td className="px-4 py-3 text-slate-300">{agent.tenantId ?? 'unassigned'}</td>
                <td className="px-4 py-3 text-slate-300">{agent.card.transport ?? 'http'}</td>
                <td className="px-4 py-3 text-slate-300">
                  {formatRelativeTime(agent.lastSuccessAt)}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {formatRelativeTime(agent.lastHeartbeatAt)}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {activeTasks > 0 ? `${activeTasks} active` : `${agentTasks.length} recent`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FleetContent({
  agents,
  tasks,
  loading,
  error,
  selectedAgentId,
  healthStaleAfterMs,
  onSelectAgent,
}: Readonly<FleetContentProps>) {
  if (loading) {
    return <EmptyState title="Loading fleet" body="Fetching the latest registry state." />;
  }
  if (error && agents.length === 0) {
    return <ErrorState title="Registry unavailable" body={error} />;
  }
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No matching agents"
        body="Try clearing one of the filters or register a public agent."
      />
    );
  }

  return (
    <FleetTable
      agents={agents}
      tasks={tasks}
      selectedAgentId={selectedAgentId}
      healthStaleAfterMs={healthStaleAfterMs}
      onSelectAgent={onSelectAgent}
    />
  );
}

export function RegistryFleetView({
  agents,
  tasks,
  loading,
  error,
  selectedAgentId,
  healthStaleAfterMs,
  taskStreamConnected,
  onSelectAgent,
}: Readonly<RegistryFleetViewProps>) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#111820]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Fleet table</h2>
          <p className="mt-1 text-xs text-slate-400">
            {agents.length} visible agents, {tasks.length} recent task events
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-slate-400">
          <Workflow size={14} />
          {taskStreamConnected ? 'Live task feed connected' : 'Task feed polling'}
        </span>
      </div>

      <FleetContent
        agents={agents}
        tasks={tasks}
        loading={loading}
        error={error}
        selectedAgentId={selectedAgentId}
        healthStaleAfterMs={healthStaleAfterMs}
        onSelectAgent={onSelectAgent}
      />
    </section>
  );
}
