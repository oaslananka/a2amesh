import { CheckCircle2, CircleDashed, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import type { RegisteredAgent, RegistryTaskEvent } from '../api/registry';

interface ConformanceDashboardProps {
  agents: RegisteredAgent[];
  tasks: RegistryTaskEvent[];
  selectedAgent: RegisteredAgent | null;
}

type RequirementStatus = 'pass' | 'partial' | 'fail';

interface RequirementResult {
  id: string;
  label: string;
  description: string;
  status: RequirementStatus;
  evidence: string;
}

interface ConformanceSummary {
  passed: number;
  partial: number;
  failed: number;
  total: number;
  score: number;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function operationEvidence(tasks: RegistryTaskEvent[], terminalStates: string[]): string {
  const matching = tasks.filter((task) => terminalStates.includes(task.status));
  if (matching.length === 0) {
    return 'No matching task event has been observed in the registry stream yet.';
  }

  const latest = matching[0];
  return `${matching.length} event(s), latest ${latest.taskId} on ${latest.agentName}.`;
}

function evaluateAgent(
  agent: RegisteredAgent | null,
  tasks: RegistryTaskEvent[],
): RequirementResult[] {
  const capabilities = agent?.card.capabilities ?? {};
  const agentTasks = agent ? tasks.filter((task) => task.agentId === agent.id) : [];
  const hasTaskHistory = agentTasks.length > 0;
  const hasArtifacts = agentTasks.some((task) => task.artifactCount > 0);
  const hasTerminalSuccess = agentTasks.some((task) => task.status === 'COMPLETED');
  const hasTerminalFailure = agentTasks.some((task) =>
    ['FAILED', 'CANCELED'].includes(task.status),
  );

  return [
    {
      id: 'agent-card',
      label: 'Agent Card metadata',
      description: 'Name, description, version, URL, skills, and transport metadata are present.',
      status:
        agent?.card.name && agent.card.description && agent.card.version && agent.url
          ? 'pass'
          : 'fail',
      evidence: agent
        ? `${agent.card.name} advertises ${agent.card.skills?.length ?? 0} skill(s) over ${
            agent.card.transport ?? 'default transport'
          }.`
        : 'No agent is selected for inspection.',
    },
    {
      id: 'message-send',
      label: 'message/send readiness',
      description: 'The selected agent can be addressed with a basic task submission preview.',
      status: agent && agent.status !== 'unhealthy' ? 'pass' : 'partial',
      evidence: agent
        ? `${agent.card.name} is currently ${agent.status}; operator can dry-run payloads before dispatch.`
        : 'No agent is available for a send preview.',
    },
    {
      id: 'message-stream',
      label: 'message/stream capability',
      description: 'Streaming task updates are advertised and represented in the operator UI.',
      status: capabilities.streaming ? 'pass' : 'partial',
      evidence: capabilities.streaming
        ? 'Agent Card advertises streaming=true.'
        : 'Streaming is not advertised by this Agent Card.',
    },
    {
      id: 'task-read-model',
      label: 'Task read model',
      description:
        'Recent task events expose task id, context, state, history, and artifact counts.',
      status: hasTaskHistory ? 'pass' : 'partial',
      evidence: hasTaskHistory
        ? `${agentTasks.length} task event(s) available for this agent.`
        : 'No recent task event has been captured for this agent yet.',
    },
    {
      id: 'terminal-states',
      label: 'Terminal state coverage',
      description: 'Completed, failed, or canceled tasks can be surfaced for conformance review.',
      status:
        hasTerminalSuccess && hasTerminalFailure ? 'pass' : hasTerminalSuccess ? 'partial' : 'fail',
      evidence: operationEvidence(agentTasks, ['COMPLETED', 'FAILED', 'CANCELED']),
    },
    {
      id: 'artifact-surface',
      label: 'Artifact surface',
      description: 'Task artifacts are visible enough for operators to verify result delivery.',
      status: hasArtifacts ? 'pass' : 'partial',
      evidence: hasArtifacts
        ? 'At least one observed task includes artifactCount > 0.'
        : 'No artifact-bearing task has been observed for this agent yet.',
    },
    {
      id: 'push-notifications',
      label: 'Push notification capability',
      description: 'Agent Card signals push notification support where applicable.',
      status: capabilities.pushNotifications ? 'pass' : 'partial',
      evidence: capabilities.pushNotifications
        ? 'Agent Card advertises pushNotifications=true.'
        : 'Push notifications are not advertised by this Agent Card.',
    },
    {
      id: 'extended-card',
      label: 'Extended capability hints',
      description: 'Optional runtime extensions such as MCP bridge or state history are visible.',
      status:
        capabilities.mcpCompatible ||
        capabilities.stateTransitionHistory ||
        capabilities.backgroundJobs
          ? 'pass'
          : 'partial',
      evidence:
        [
          capabilities.mcpCompatible ? 'mcp' : null,
          capabilities.stateTransitionHistory ? 'state history' : null,
          capabilities.backgroundJobs ? 'background jobs' : null,
        ]
          .filter(Boolean)
          .join(', ') || 'No optional extension hints are advertised.',
    },
  ];
}

function summarize(results: RequirementResult[]): ConformanceSummary {
  const passed = results.filter((result) => result.status === 'pass').length;
  const partial = results.filter((result) => result.status === 'partial').length;
  const failed = results.filter((result) => result.status === 'fail').length;
  const total = results.length;
  const score = Math.round(((passed + partial * 0.5) / Math.max(total, 1)) * 100);

  return { passed, partial, failed, total, score };
}

function StatusIcon({ status }: { status: RequirementStatus }) {
  if (status === 'pass') {
    return <CheckCircle2 size={18} className="text-emerald-200" aria-hidden="true" />;
  }
  if (status === 'fail') {
    return <XCircle size={18} className="text-rose-200" aria-hidden="true" />;
  }
  return <CircleDashed size={18} className="text-amber-200" aria-hidden="true" />;
}

export function ConformanceDashboard({ agents, tasks, selectedAgent }: ConformanceDashboardProps) {
  const activeAgent = selectedAgent ?? agents[0] ?? null;
  const results = useMemo(() => evaluateAgent(activeAgent, tasks), [activeAgent, tasks]);
  const summary = useMemo(() => summarize(results), [results]);
  const globalCoverage = useMemo(
    () => ({
      sendCapable: agents.filter((agent) => agent.status !== 'unhealthy').length,
      streaming: agents.filter((agent) => agent.card.capabilities?.streaming).length,
      push: agents.filter((agent) => agent.card.capabilities?.pushNotifications).length,
      mcp: agents.filter((agent) => agent.card.capabilities?.mcpCompatible).length,
      taskEvents: tasks.length,
    }),
    [agents, tasks],
  );

  return (
    <section className="rounded-lg border border-emerald-300/15 bg-[#111820] p-5">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200">Conformance</p>
          <h2 className="mt-2 text-xl font-semibold text-white">A2A compliance dashboard</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Review Agent Card metadata, task operation readiness, streaming support, artifact
            visibility, and extension hints before promoting an agent to production traffic.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-100">Score</p>
          <p className="mt-1 text-3xl font-semibold text-white">{summary.score}%</p>
          <p className="mt-1 text-xs text-emerald-100">
            {summary.passed}/{summary.total} pass · {summary.partial} partial · {summary.failed}{' '}
            fail
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-5">
        <CoverageCard
          label="Send ready"
          value={globalCoverage.sendCapable}
          detail="healthy/unknown"
        />
        <CoverageCard label="Streaming" value={globalCoverage.streaming} detail="Agent Card" />
        <CoverageCard label="Push" value={globalCoverage.push} detail="Agent Card" />
        <CoverageCard label="MCP" value={globalCoverage.mcp} detail="extension" />
        <CoverageCard
          label="Task events"
          value={globalCoverage.taskEvents}
          detail="recent stream"
        />
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Selected agent report</h3>
            <p className="mt-1 text-sm text-slate-400">
              {activeAgent
                ? `${activeAgent.card.name} · ${activeAgent.url}`
                : 'No registered agent is available.'}
            </p>
          </div>
          <span
            className={classNames(
              'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]',
              summary.failed === 0
                ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                : 'border-rose-300/25 bg-rose-300/10 text-rose-100',
            )}
          >
            <ShieldCheck size={14} />
            {summary.failed === 0 ? 'release candidate' : 'needs evidence'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {results.map((result) => (
            <article
              key={result.id}
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-start gap-3">
                <StatusIcon status={result.status} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">{result.label}</h4>
                    <span
                      className={classNames(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]',
                        result.status === 'pass'
                          ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                          : result.status === 'fail'
                            ? 'border-rose-300/20 bg-rose-300/10 text-rose-100'
                            : 'border-amber-300/20 bg-amber-300/10 text-amber-100',
                      )}
                    >
                      {result.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{result.description}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Evidence: {result.evidence}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CoverageCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}
