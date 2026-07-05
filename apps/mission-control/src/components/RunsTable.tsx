import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { approveRun, rejectRun, type FleetRun } from '../api/fleet';
import { StatusBadge } from './StatusBadge';

export function RunsTable({
  runs,
  loading,
  error,
  selectedRunId,
  onSelect,
  onChanged,
}: {
  runs: FleetRun[];
  loading: boolean;
  error: string | null;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onChanged: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const handleApprove = async (runId: string) => {
    setPendingAction(runId);
    try {
      await approveRun(runId, 'operator');
      onChanged();
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async (runId: string) => {
    setPendingAction(runId);
    try {
      await rejectRun(runId, 'operator', 'rejected from Mission Control');
      onChanged();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#111820]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Runs</h2>
          <p className="mt-1 text-xs text-slate-400">{runs.length} tracked runs</p>
        </div>
      </div>

      {loading && runs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">Loading runs…</p>
      ) : error && runs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-rose-100">{error}</p>
      ) : runs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          No runs yet. Route a task to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/8 text-sm">
            <thead className="bg-white/4 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={`cursor-pointer transition hover:bg-white/4 ${
                    selectedRunId === run.id ? 'bg-cyan-300/8' : ''
                  }`}
                  onClick={() => onSelect(run.id)}
                >
                  <td className="px-4 py-3 text-slate-200">{run.taskId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{run.workerId}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.approvalState} />
                  </td>
                  <td className="px-4 py-3">
                    {run.approvalState === 'PENDING' ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={pendingAction === run.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleApprove(run.id);
                          }}
                          aria-label={`Approve run for task ${run.taskId}`}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100 transition hover:bg-emerald-400/20 disabled:opacity-50"
                        >
                          <Check size={12} />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={pendingAction === run.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleReject(run.id);
                          }}
                          aria-label={`Reject run for task ${run.taskId}`}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50"
                        >
                          <X size={12} />
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
