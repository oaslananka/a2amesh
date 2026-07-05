import { useState } from 'react';
import { RefreshCw, Satellite } from 'lucide-react';
import { useWorkers } from './hooks/useWorkers';
import { useRuns } from './hooks/useRuns';
import { WorkerHealthPanel } from './components/WorkerHealthPanel';
import { RoutingPanel } from './components/RoutingPanel';
import { RunsTable } from './components/RunsTable';
import { RunDetail } from './components/RunDetail';

export default function App() {
  const {
    workers,
    loading: workersLoading,
    error: workersError,
    refresh: refreshWorkers,
  } = useWorkers();
  const {
    runs,
    loading: runsLoading,
    error: runsError,
    connected: runsConnected,
    refresh: refreshRuns,
  } = useRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const pendingApprovalCount = runs.filter((run) => run.approvalState === 'PENDING').length;

  const handleRefresh = () => {
    void refreshWorkers();
    void refreshRuns();
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0f141a_0%,#131b22_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-5 lg:px-6">
        <header className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <Satellite size={16} className="text-cyan-300" />
              <span>Fleet control plane</span>
              <span className="text-slate-500">/</span>
              <span>worker health, routing, approvals, artifacts, audit</span>
            </div>
            <div>
              <h1 className="mesh-display text-3xl font-semibold text-white">Mission Control</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                The operator surface above `@a2amesh/internal-fleet-server`: route tasks, watch live
                worker health, clear the approval queue for gated side effects, and review artifacts
                and the audit timeline for any run.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pendingApprovalCount > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-100">
                {pendingApprovalCount} awaiting approval
              </span>
            ) : null}
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
              {runsConnected ? 'Live updates connected' : 'Live updates reconnecting…'}
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_400px]">
          <main className="min-w-0 space-y-6">
            <WorkerHealthPanel workers={workers} loading={workersLoading} error={workersError} />
            <RunsTable
              runs={runs}
              loading={runsLoading}
              error={runsError}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              onChanged={refreshRuns}
            />
          </main>

          <aside className="space-y-6">
            <RoutingPanel onRouted={refreshRuns} />
            <RunDetail runId={selectedRunId} />
          </aside>
        </div>
      </div>
    </div>
  );
}
