import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Globe2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  emptyMetrics,
  fetchMetrics,
  type RegisteredAgent,
  type RegistryMetrics,
} from './api/registry';
import { AgentInspector } from './components/AgentInspector';
import { ConformanceDashboard } from './components/ConformanceDashboard';
import { EnterpriseControlsPanel } from './components/EnterpriseControlsPanel';
import { HealthBadge } from './components/HealthBadge';
import { PlaygroundPanel } from './components/PlaygroundPanel';
import { RegisterAgentPanel } from './components/RegisterAgentPanel';
import { TaskStream } from './components/TaskStream';
import { TopologyGraph } from './components/TopologyGraph';
import { useAgents } from './hooks/useAgents';
import { useTaskStream } from './hooks/useTaskStream';

type ViewMode =
  | 'fleet'
  | 'topology'
  | 'stream'
  | 'playground'
  | 'conformance'
  | 'controls'
  | 'register';
type StatusFilter = 'all' | 'healthy' | 'unhealthy' | 'unknown';
type CapabilityFilter = 'all' | 'streaming' | 'mcp';

function matchesQuery(agent: RegisteredAgent, query: string): boolean {
  const haystack = [
    agent.card.name,
    agent.card.description,
    agent.tenantId,
    ...(agent.card.skills ?? []).map((skill) => `${skill.name} ${(skill.tags ?? []).join(' ')}`),
    ...(agent.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query.trim().toLowerCase());
}

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) {
    return 'Never';
  }

  const deltaMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(deltaMs)) {
    return 'Unknown';
  }

  const deltaMinutes = Math.floor(deltaMs / 60000);
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export default function App() {
  const { agents, loading, error, accessMode, refresh } = useAgents();
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    connected: taskStreamConnected,
    refresh: refreshTasks,
  } = useTaskStream(accessMode);
  const [metrics, setMetrics] = useState<RegistryMetrics>(emptyMetrics());
  const [view, setView] = useState<ViewMode>('fleet');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>('all');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    async function loadMetrics() {
      const nextMetrics = await fetchMetrics();
      startTransition(() => {
        setMetrics(nextMetrics);
      });
    }

    void loadMetrics();
    const interval = window.setInterval(() => {
      void loadMetrics();
    }, 10_000);

    return () => window.clearInterval(interval);
  }, []);

  const tenants = useMemo(
    () =>
      Array.from(
        new Set(
          agents
            .map((agent) => agent.tenantId)
            .filter((tenant): tenant is string => Boolean(tenant)),
        ),
      ).sort(),
    [agents],
  );

  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => {
        const matchesStatus = statusFilter === 'all' ? true : agent.status === statusFilter;
        const matchesCapability =
          capabilityFilter === 'all'
            ? true
            : capabilityFilter === 'streaming'
              ? agent.card.capabilities?.streaming === true
              : agent.card.capabilities?.mcpCompatible === true;
        const matchesTenant =
          tenantFilter === 'all' ? true : (agent.tenantId ?? 'unassigned') === tenantFilter;

        return (
          matchesStatus && matchesCapability && matchesTenant && matchesQuery(agent, deferredSearch)
        );
      }),
    [agents, capabilityFilter, deferredSearch, statusFilter, tenantFilter],
  );

  useEffect(() => {
    if (!selectedAgentId && filteredAgents.length > 0) {
      setSelectedAgentId(filteredAgents[0]?.id ?? null);
      return;
    }

    if (selectedAgentId && !filteredAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(filteredAgents[0]?.id ?? null);
    }
  }, [filteredAgents, selectedAgentId]);

  const selectedAgent =
    filteredAgents.find((agent) => agent.id === selectedAgentId) ??
    agents.find((agent) => agent.id === selectedAgentId) ??
    null;
  const selectedAgentTasks = selectedAgent
    ? tasks.filter((task) => task.agentId === selectedAgent.id)
    : [];
  const activeTaskCount = tasks.filter((task) =>
    ['SUBMITTED', 'QUEUED', 'WORKING', 'INPUT_REQUIRED', 'WAITING_ON_EXTERNAL'].includes(
      task.status,
    ),
  ).length;

  const handleRefresh = () => {
    void refresh();
    void refreshTasks();
  };

  const handleAgentRegistered = (agent: RegisteredAgent) => {
    setSelectedAgentId(agent.id);
    handleRefresh();
  };

  const handleAgentDeleted = (agentId: string) => {
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null);
    }
    handleRefresh();
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0f141a_0%,#131b22_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-6 px-4 py-5 lg:px-6">
        <header className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <ShieldCheck size={16} className="text-emerald-300" />
              <span>Registry control plane</span>
              <span className="text-slate-500">/</span>
              <span>fleet health, recent activity, tenancy visibility</span>
            </div>
            <div>
              <h1 className="mesh-display text-3xl font-semibold text-white">
                a2amesh operator console
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Discovery, health, task activity, and topology in one surface. This view prefers
                operator answers over demo gloss.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={classNames(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                accessMode === 'authenticated'
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  : 'border-amber-400/30 bg-amber-400/10 text-amber-100',
              )}
            >
              {accessMode === 'authenticated' ? <Lock size={14} /> : <Globe2 size={14} />}
              {accessMode === 'authenticated' ? 'Operator mode' : 'Public discovery mode'}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-100"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        {accessMode !== 'authenticated' ? (
          <section className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Live task feeds and admin actions are hidden until the registry is reached with operator
            authentication. Public agents remain visible for discovery.
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricTile
            label="Fleet"
            value={metrics.agentCount || agents.length}
            detail="registered agents"
          />
          <MetricTile
            label="Healthy"
            value={metrics.healthyAgents}
            detail="passing health checks"
            accent="emerald"
          />
          <MetricTile
            label="Degraded"
            value={metrics.unhealthyAgents}
            detail="need operator attention"
            accent="rose"
          />
          <MetricTile
            label="Active tasks"
            value={activeTaskCount}
            detail="recent active work"
            accent="cyan"
          />
          <MetricTile
            label="Tenants"
            value={metrics.activeTenants}
            detail="visible namespaces"
            accent="amber"
          />
        </section>

        <section className="flex flex-col gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative max-w-xl flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search agents"
                placeholder="Search by name, skill, tag, or tenant"
                className="w-full rounded-lg border border-white/10 bg-slate-950/45 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/35"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'healthy', 'unhealthy', 'unknown'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  aria-pressed={statusFilter === filter}
                  className={classNames(
                    'rounded-lg border px-3 py-2 text-sm transition',
                    statusFilter === filter
                      ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20',
                  )}
                >
                  {filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={capabilityFilter}
              onChange={(event) => setCapabilityFilter(event.target.value as CapabilityFilter)}
              aria-label="Filter by capability"
              className="rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="all">All capabilities</option>
              <option value="streaming">Streaming</option>
              <option value="mcp">MCP compatible</option>
            </select>
            <select
              value={tenantFilter}
              onChange={(event) => setTenantFilter(event.target.value)}
              aria-label="Filter by tenant"
              className="rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="all">All tenants</option>
              <option value="unassigned">Unassigned</option>
              {tenants.map((tenant) => (
                <option key={tenant} value={tenant}>
                  {tenant}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              <ViewButton
                active={view === 'fleet'}
                label="Fleet Overview"
                onClick={() => setView('fleet')}
              />
              <ViewButton
                active={view === 'topology'}
                label="Live Topology"
                onClick={() => setView('topology')}
              />
              <ViewButton
                active={view === 'stream'}
                label="Task Stream"
                onClick={() => setView('stream')}
              />
              <ViewButton
                active={view === 'playground'}
                label="Playground"
                onClick={() => setView('playground')}
              />
              <ViewButton
                active={view === 'conformance'}
                label="Conformance"
                onClick={() => setView('conformance')}
              />
              <ViewButton
                active={view === 'controls'}
                label="Controls"
                onClick={() => setView('controls')}
              />
              <ViewButton
                active={view === 'register'}
                label="Register"
                onClick={() => setView('register')}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_420px]">
          <main className="min-w-0 space-y-6">
            {view === 'fleet' ? (
              <section className="overflow-hidden rounded-lg border border-white/10 bg-[#111820]">
                <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Fleet table</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      {filteredAgents.length} visible agents, {tasks.length} recent task events
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                    <Workflow size={14} />
                    {taskStreamConnected ? 'Live task feed connected' : 'Task feed polling'}
                  </span>
                </div>

                {loading ? (
                  <EmptyState title="Loading fleet" body="Fetching the latest registry state." />
                ) : error && filteredAgents.length === 0 ? (
                  <ErrorState title="Registry unavailable" body={error} />
                ) : filteredAgents.length === 0 ? (
                  <EmptyState
                    title="No matching agents"
                    body="Try clearing one of the filters or register a public agent."
                  />
                ) : (
                  <div
                    className="overflow-x-auto"
                    tabIndex={0}
                    aria-label="Fleet table scroll area"
                  >
                    <table className="min-w-full divide-y divide-white/8 text-sm">
                      <thead className="bg-white/4 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Agent</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Tenant</th>
                          <th className="px-4 py-3">Transport</th>
                          <th className="px-4 py-3">Last success</th>
                          <th className="px-4 py-3">Heartbeat drift</th>
                          <th className="px-4 py-3">Recent tasks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/6">
                        {filteredAgents.map((agent) => {
                          const agentTasks = tasks.filter((task) => task.agentId === agent.id);
                          const activeTasks = agentTasks.filter((task) =>
                            [
                              'SUBMITTED',
                              'QUEUED',
                              'WORKING',
                              'INPUT_REQUIRED',
                              'WAITING_ON_EXTERNAL',
                            ].includes(task.status),
                          ).length;
                          return (
                            <tr
                              key={agent.id}
                              className={classNames(
                                'cursor-pointer transition hover:bg-white/4',
                                selectedAgent?.id === agent.id && 'bg-cyan-300/8',
                              )}
                              onClick={() => setSelectedAgentId(agent.id)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 rounded-md border border-white/10 bg-white/5 p-2">
                                    <Bot size={16} className="text-cyan-200" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-white">
                                        {agent.card.name}
                                      </span>
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
                              <td className="px-4 py-3 text-slate-300">
                                {agent.tenantId ?? 'unassigned'}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {agent.card.transport ?? 'http'}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {formatRelativeTime(agent.lastSuccessAt)}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {formatRelativeTime(agent.lastHeartbeatAt)}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {activeTasks > 0
                                  ? `${activeTasks} active`
                                  : `${agentTasks.length} recent`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}

            {view === 'topology' ? (
              <TopologyGraph
                agents={filteredAgents}
                selectedAgentId={selectedAgent?.id ?? null}
                onSelect={(agent) => setSelectedAgentId(agent.id)}
              />
            ) : null}

            {view === 'stream' ? (
              <TaskStream
                tasks={tasks}
                loading={tasksLoading}
                error={tasksError}
                connected={taskStreamConnected}
                selectedAgentId={selectedAgent?.id ?? null}
              />
            ) : null}

            {view === 'playground' ? (
              <PlaygroundPanel
                agents={filteredAgents}
                tasks={tasks}
                selectedAgent={selectedAgent}
                accessMode={accessMode}
                onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
              />
            ) : null}

            {view === 'conformance' ? (
              <ConformanceDashboard
                agents={filteredAgents}
                tasks={tasks}
                selectedAgent={selectedAgent}
              />
            ) : null}

            {view === 'controls' ? (
              <EnterpriseControlsPanel
                agents={filteredAgents}
                tasks={tasks}
                accessMode={accessMode}
              />
            ) : null}

            {view === 'register' ? (
              <RegisterAgentPanel accessMode={accessMode} onRegistered={handleAgentRegistered} />
            ) : null}
          </main>

          <aside className="space-y-6">
            <AgentInspector
              selectedAgent={selectedAgent}
              selectedAgentTasks={selectedAgentTasks}
              accessMode={accessMode}
              formatRelativeTime={formatRelativeTime}
              onDeleted={handleAgentDeleted}
            />

            <section className="rounded-lg border border-white/10 bg-[#111820] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                    Recent activity
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-white">Task summary</h3>
                </div>
                <span className="text-xs text-slate-400">
                  {selectedAgent ? `${selectedAgentTasks.length} events` : `${tasks.length} events`}
                </span>
              </div>

              {tasksLoading ? (
                <p className="mt-4 text-sm text-slate-400">Loading task activity…</p>
              ) : tasksError ? (
                <p className="mt-4 text-sm text-amber-100">{tasksError}</p>
              ) : (selectedAgent ? selectedAgentTasks : tasks).length === 0 ? (
                <EmptyState
                  title="No recent tasks"
                  body="This agent has no task events in the current registry window."
                  compact
                />
              ) : (
                <div className="mt-4 space-y-3">
                  {(selectedAgent ? selectedAgentTasks : tasks).slice(0, 6).map((task) => (
                    <article
                      key={`${task.agentId}-${task.taskId}`}
                      className="rounded-lg border border-white/8 bg-black/15 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">{task.agentName}</span>
                        <span className="text-xs text-slate-400">
                          {formatRelativeTime(task.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {task.summary ?? 'Task event captured without a text summary.'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        <span>{task.status}</span>
                        <span>{task.historyCount} messages</span>
                        <span>{task.artifactCount} artifacts</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {error ? (
              <ErrorState title="Registry connectivity warning" body={error} compact />
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  accent = 'cyan',
}: {
  label: string;
  value: number;
  detail: string;
  accent?: 'cyan' | 'emerald' | 'rose' | 'amber';
}) {
  const accents = {
    cyan: 'border-cyan-300/20',
    emerald: 'border-emerald-300/20',
    rose: 'border-rose-300/20',
    amber: 'border-amber-300/20',
  } as const;

  return (
    <div className={classNames('rounded-lg border bg-[#111820] px-4 py-4', accents[accent])}>
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={classNames(
        'rounded-md px-3 py-2 text-sm transition',
        active
          ? 'bg-cyan-300/14 text-cyan-100'
          : 'text-slate-300 hover:bg-white/6 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className={classNames(
        'flex flex-col items-center justify-center text-center text-slate-400',
        compact ? 'px-2 py-4' : 'px-6 py-16',
      )}
    >
      <Activity size={compact ? 18 : 24} className="mb-3 text-slate-500" />
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6">{body}</p>
    </div>
  );
}

function ErrorState({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className={classNames(
        'rounded-lg border border-rose-400/20 bg-rose-400/10 text-rose-100',
        compact ? 'px-3 py-3' : 'px-6 py-16 text-center',
      )}
    >
      <div className={classNames('flex items-center gap-2', compact ? '' : 'justify-center')}>
        <AlertTriangle size={16} />
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-rose-100/85">{body}</p>
    </div>
  );
}
