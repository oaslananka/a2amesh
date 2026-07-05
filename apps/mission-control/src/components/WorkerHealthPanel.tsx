import { Cpu } from 'lucide-react';
import type { FleetWorkerSummary } from '../api/fleet';
import { StatusBadge } from './StatusBadge';

export function WorkerHealthPanel({
  workers,
  loading,
  error,
}: {
  workers: FleetWorkerSummary[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#111820]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Worker health</h2>
          <p className="mt-1 text-xs text-slate-400">{workers.length} discovered workers</p>
        </div>
      </div>

      {loading && workers.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">Loading worker health…</p>
      ) : error && workers.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-rose-100">{error}</p>
      ) : workers.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          No workers discovered yet. Register a worker card with the registry to see it here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/8 text-sm">
            <thead className="bg-white/4 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Capabilities</th>
                <th className="px-4 py-3">Concurrency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {workers.map((worker) => (
                <tr key={worker.workerId}>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-md border border-white/10 bg-white/5 p-2">
                        <Cpu size={16} className="text-cyan-200" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-white">{worker.name}</span>
                        <p className="mt-1 truncate text-xs text-slate-400">{worker.workerId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={worker.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <div className="flex flex-wrap gap-1">
                      {worker.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {worker.activeRunCount}
                    {worker.maxConcurrentTasks !== undefined
                      ? ` / ${worker.maxConcurrentTasks}`
                      : ''}
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
