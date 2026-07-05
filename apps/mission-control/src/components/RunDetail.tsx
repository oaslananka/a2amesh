import { useEffect, useState } from 'react';
import { FileText, History } from 'lucide-react';
import {
  fetchAudit,
  fetchRunArtifacts,
  type FleetAuditEntry,
  type FleetArtifactRecord,
} from '../api/fleet';

function formatTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleTimeString() : timestamp;
}

export function RunDetail({ runId }: { runId: string | null }) {
  const [artifacts, setArtifacts] = useState<FleetArtifactRecord[]>([]);
  const [audit, setAudit] = useState<FleetAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setArtifacts([]);
      setAudit([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchRunArtifacts(runId), fetchAudit({ runId })])
      .then(([nextArtifacts, nextAudit]) => {
        if (cancelled) return;
        setArtifacts(nextArtifacts);
        setAudit(nextAudit);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (!runId) {
    return (
      <section className="rounded-lg border border-white/10 bg-[#111820] p-4">
        <p className="text-sm text-slate-400">
          Select a run to review its artifacts and audit timeline.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-[#111820] p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
          <FileText size={14} />
          Artifacts
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : artifacts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No artifacts submitted for this run yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.artifactId}
                className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{artifact.artifactId}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                    {artifact.kind}
                  </span>
                </div>
                {artifact.content ? (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-400">
                    {artifact.content}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-[#111820] p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
          <History size={14} />
          Audit timeline
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No audit entries yet.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {audit.map((entry) => (
              <li
                key={entry.sequence}
                className="flex items-center justify-between rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-white">{entry.action}</span>
                  {entry.actor ? (
                    <span className="ml-2 text-xs text-slate-400">by {entry.actor}</span>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">{formatTimestamp(entry.timestamp)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
