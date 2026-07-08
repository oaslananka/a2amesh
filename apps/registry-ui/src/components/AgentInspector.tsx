import { useEffect, useMemo, useState } from 'react';
import {
  deleteAgent,
  RegistryApiError,
  type RegisteredAgent,
  type RegistryAccessMode,
  type RegistryTaskEvent,
} from '../api/registry';
import { HealthBadge } from './HealthBadge';

interface AgentInspectorProps {
  selectedAgent: RegisteredAgent | null;
  selectedAgentTasks: RegistryTaskEvent[];
  accessMode: RegistryAccessMode;
  formatRelativeTime: (timestamp?: string) => string;
  onDeleted?: (agentId: string) => void;
}

function fallbackRemediationHints(agent: RegisteredAgent): string[] {
  if (agent.health?.remediationHints?.length) {
    return agent.health.remediationHints;
  }

  if (agent.status === 'unhealthy') {
    return [
      'Check the last heartbeat timestamp and registry callback connectivity.',
      'Verify provider credentials and transport-specific timeout settings.',
      'Replay the latest failed task after dependency health is restored.',
    ];
  }

  if (agent.status === 'unknown') {
    return [
      'Confirm the agent can reach the registry heartbeat endpoint.',
      'Check whether this is a public discovery-only agent with no private health feed.',
    ];
  }

  return ['No operator action is required. Keep monitoring task latency and heartbeat drift.'];
}

function describeHealth(agent: RegisteredAgent): string {
  if (agent.health?.reason) {
    return agent.health.reason;
  }

  if (agent.status === 'unhealthy') {
    const failures = agent.consecutiveFailures ?? 0;
    return failures > 0
      ? `${failures} consecutive health checks failed.`
      : 'Health checks are failing without a structured reason from the registry.';
  }

  if (agent.status === 'unknown') {
    return 'The registry has not received enough recent health data to classify this agent.';
  }

  return 'Health checks are passing.';
}

function buildAgentConfig(agent: RegisteredAgent) {
  return {
    id: agent.id,
    url: agent.url,
    tenantId: agent.tenantId ?? null,
    visibility: agent.isPublic ? 'public' : 'private',
    transport: agent.card.transport ?? 'http',
    capabilities: agent.card.capabilities ?? {},
    skills: agent.card.skills ?? [],
    tags: agent.tags ?? [],
  };
}

async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) {
    return false;
  }

  await navigator.clipboard.writeText(value);
  return true;
}

export function AgentInspector({
  selectedAgent,
  selectedAgentTasks,
  accessMode,
  formatRelativeTime,
  onDeleted,
}: AgentInspectorProps) {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const latestTask = selectedAgentTasks[0];
  const remediationHints = useMemo(
    () => (selectedAgent ? fallbackRemediationHints(selectedAgent) : []),
    [selectedAgent],
  );

  useEffect(() => {
    setConfirmingDelete(false);
    setDeleteError(null);
  }, [selectedAgent?.id]);

  if (!selectedAgent) {
    return (
      <section className="rounded-lg border border-white/10 bg-[#111820] p-4">
        <EmptyState
          title="No selection"
          body="Pick a fleet row or topology node to inspect transport, drift, and recent task activity."
        />
      </section>
    );
  }

  const copyAgentCard = async () => {
    const copied = await copyText(JSON.stringify(selectedAgent.card, null, 2));
    setActionMessage(copied ? 'Agent card copied.' : 'Clipboard unavailable for agent card.');
  };

  const exportConfig = async () => {
    const copied = await copyText(JSON.stringify(buildAgentConfig(selectedAgent), null, 2));
    setActionMessage(
      copied ? 'Agent config exported.' : 'Clipboard unavailable for config export.',
    );
  };

  const prepareReplay = () => {
    if (!latestTask) {
      setActionMessage('No recent task is available to replay.');
      return;
    }

    setActionMessage(`Replay prepared for ${latestTask.taskId}.`);
  };

  const handleDeleteClick = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgent(selectedAgent.id);
      onDeleted?.(selectedAgent.id);
    } catch (deleteAgentError) {
      setDeleteError(
        deleteAgentError instanceof RegistryApiError
          ? deleteAgentError.message
          : 'Failed to delete agent.',
      );
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-white/10 bg-[#111820] p-4"
      aria-labelledby="agent-inspector-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Selected agent</p>
          <h2 id="agent-inspector-heading" className="mt-2 text-lg font-semibold text-white">
            {selectedAgent.card.name}
          </h2>
        </div>
        <HealthBadge status={selectedAgent.status} />
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-300">{selectedAgent.card.description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <VisibilityPill label={selectedAgent.isPublic ? 'public discovery' : 'private agent'} />
        <VisibilityPill label={`tenant: ${selectedAgent.tenantId ?? 'unassigned'}`} />
        <VisibilityPill
          label={accessMode === 'authenticated' ? 'operator actions enabled' : 'read-only'}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        <InfoRow label="URL" value={selectedAgent.url} />
        <InfoRow label="Transport" value={selectedAgent.card.transport ?? 'http'} />
        <InfoRow label="Registered" value={formatRelativeTime(selectedAgent.registeredAt)} />
        <InfoRow label="Last heartbeat" value={formatRelativeTime(selectedAgent.lastHeartbeatAt)} />
        <InfoRow label="Last success" value={formatRelativeTime(selectedAgent.lastSuccessAt)} />
        <InfoRow label="Failures" value={String(selectedAgent.consecutiveFailures ?? 0)} />
      </dl>

      <div className="mt-5 rounded-lg border border-white/8 bg-black/15 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Health reason</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">{describeHealth(selectedAgent)}</p>
          </div>
          {selectedAgent.health?.checkedAt ? (
            <span className="whitespace-nowrap text-xs text-slate-500">
              {formatRelativeTime(selectedAgent.health.checkedAt)}
            </span>
          ) : null}
        </div>

        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {remediationHints.map((hint) => (
            <li key={hint} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/80" />
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Capabilities</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(selectedAgent.card.capabilities?.streaming ?? false) ? (
            <CapabilityPill label="streaming" />
          ) : null}
          {(selectedAgent.card.capabilities?.pushNotifications ?? false) ? (
            <CapabilityPill label="push" />
          ) : null}
          {(selectedAgent.card.capabilities?.mcpCompatible ?? false) ? (
            <CapabilityPill label="mcp" />
          ) : null}
          {(selectedAgent.card.capabilities?.backgroundJobs ?? false) ? (
            <CapabilityPill label="background jobs" />
          ) : null}
          {Object.values(selectedAgent.card.capabilities ?? {}).some(Boolean) ? null : (
            <span className="text-sm text-slate-400">No declared capabilities.</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Skills</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(selectedAgent.card.skills ?? []).length > 0 ? (
            (selectedAgent.card.skills ?? []).map((skill) => (
              <span
                key={skill.id}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100"
              >
                {skill.name}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-400">No declared skills.</span>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <QuickActionButton label="Copy card" onClick={copyAgentCard} />
        <QuickActionButton label="Export config" onClick={exportConfig} />
        <QuickActionButton label="Replay latest" onClick={prepareReplay} />
      </div>

      {accessMode === 'authenticated' ? (
        <div className="mt-2">
          <DangerActionButton
            label={
              deleting ? 'Deleting…' : confirmingDelete ? 'Confirm delete agent' : 'Delete agent'
            }
            disabled={deleting}
            onClick={handleDeleteClick}
          />
          {confirmingDelete && !deleting ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="ml-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {actionMessage ? (
        <p className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
          {actionMessage}
        </p>
      ) : null}
      {deleteError ? (
        <p className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {deleteError}
        </p>
      ) : null}
    </section>
  );
}

function QuickActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
    >
      {label}
    </button>
  );
}

function DangerActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className="rounded-lg border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-200/45 hover:bg-rose-300/15 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function VisibilityPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
      {label}
    </span>
  );
}

function CapabilityPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all text-slate-100">{value}</dd>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-4 text-center text-slate-400">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6">{body}</p>
    </div>
  );
}
