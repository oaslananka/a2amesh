import { useState } from 'react';
import { Send } from 'lucide-react';
import { routeTask, type FleetSideEffectLevel, type RouteTaskResult } from '../api/fleet';

const RISK_LEVELS: FleetSideEffectLevel[] = [
  'read-only',
  'local-write',
  'remote-write',
  'publish',
  'deploy',
];

export function RoutingPanel({ onRouted }: { onRouted: () => void }) {
  const [taskId, setTaskId] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [riskLevel, setRiskLevel] = useState<FleetSideEffectLevel | ''>('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RouteTaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskId.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const routed = await routeTask({
        taskId: taskId.trim(),
        ...(capabilities.trim()
          ? {
              requiredCapabilities: capabilities
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
        ...(riskLevel ? { riskLevel } : {}),
        ...(requiresApproval ? { requiresApproval: true } : {}),
      });
      setResult(routed);
      onRouted();
    } catch (routeError) {
      setError(routeError instanceof Error ? routeError.message : 'Failed to route task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-white/10 bg-[#111820] p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Routing</p>
      <h3 className="mt-2 text-base font-semibold text-white">Route a task</h3>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs text-slate-400">Task ID</span>
          <input
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            placeholder="task-123"
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block">
          <span className="text-xs text-slate-400">Required capabilities (comma-separated)</span>
          <input
            value={capabilities}
            onChange={(event) => setCapabilities(event.target.value)}
            placeholder="code-review, patch-generation"
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block">
          <span className="text-xs text-slate-400">Risk level</span>
          <select
            value={riskLevel}
            onChange={(event) => setRiskLevel(event.target.value as FleetSideEffectLevel | '')}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">Not specified</option>
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(event) => setRequiresApproval(event.target.checked)}
            className="rounded border-white/20 bg-slate-950/45"
          />
          Require operator approval before dispatch
        </label>

        <button
          type="submit"
          disabled={submitting || !taskId.trim()}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          Route task
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-rose-100">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-white/8 bg-black/20 p-3 text-sm">
          <p className="text-slate-300">{result.decision.reason}</p>
          {result.run ? (
            <p className="mt-2 text-slate-400">
              Run <span className="font-mono text-slate-200">{result.run.id}</span> —{' '}
              {result.run.status} / {result.run.approvalState}
            </p>
          ) : (
            <p className="mt-2 text-amber-100">No worker was selected.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
