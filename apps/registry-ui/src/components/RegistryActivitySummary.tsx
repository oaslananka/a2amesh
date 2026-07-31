import { Activity } from 'lucide-react';
import type { RegisteredAgent, RegistryTaskEvent } from '../api/registry';

interface RegistryActivitySummaryProps {
  tasks: readonly RegistryTaskEvent[];
  selectedAgent: RegisteredAgent | null;
  selectedAgentTasks: readonly RegistryTaskEvent[];
  loading: boolean;
  error: string | null;
  formatRelativeTime: (timestamp?: string) => string;
}

interface ActivityContentProps {
  visibleTasks: readonly RegistryTaskEvent[];
  loading: boolean;
  error: string | null;
  formatRelativeTime: (timestamp?: string) => string;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-4 text-center text-slate-400">
      <Activity size={18} className="mb-3 text-slate-500" />
      <p className="text-sm font-medium text-slate-200">No recent tasks</p>
      <p className="mt-2 max-w-md text-sm leading-6">
        This agent has no task events in the current registry window.
      </p>
    </div>
  );
}

function ActivityContent({
  visibleTasks,
  loading,
  error,
  formatRelativeTime,
}: Readonly<ActivityContentProps>) {
  if (loading) {
    return <p className="mt-4 text-sm text-slate-400">Loading task activity…</p>;
  }
  if (error) {
    return <p className="mt-4 text-sm text-amber-100">{error}</p>;
  }
  if (visibleTasks.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="mt-4 space-y-3">
      {visibleTasks.slice(0, 6).map((task) => (
        <article
          key={`${task.agentId}-${task.taskId}`}
          className="rounded-lg border border-white/8 bg-black/15 px-3 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-white">{task.agentName}</span>
            <span className="text-xs text-slate-400">{formatRelativeTime(task.updatedAt)}</span>
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
  );
}

export function RegistryActivitySummary({
  tasks,
  selectedAgent,
  selectedAgentTasks,
  loading,
  error,
  formatRelativeTime,
}: Readonly<RegistryActivitySummaryProps>) {
  const visibleTasks = selectedAgent ? selectedAgentTasks : tasks;

  return (
    <section className="rounded-lg border border-white/10 bg-[#111820] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Recent activity</p>
          <h3 className="mt-2 text-base font-semibold text-white">Task summary</h3>
        </div>
        <span className="text-xs text-slate-400">{visibleTasks.length} events</span>
      </div>

      <ActivityContent
        visibleTasks={visibleTasks}
        loading={loading}
        error={error}
        formatRelativeTime={formatRelativeTime}
      />
    </section>
  );
}
