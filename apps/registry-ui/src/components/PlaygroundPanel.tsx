import { Code2, MessageSquareText, Play, RefreshCw, Route, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RegisteredAgent, RegistryAccessMode, RegistryTaskEvent } from '../api/registry';

type PlaygroundScenario = 'direct-task' | 'streaming-task' | 'mcp-bridge';

interface PlaygroundPanelProps {
  agents: RegisteredAgent[];
  tasks: RegistryTaskEvent[];
  selectedAgent: RegisteredAgent | null;
  accessMode: RegistryAccessMode;
  replayTaskId?: string | null;
  onSelectAgent: (agent: RegisteredAgent) => void;
}

interface TimelineStep {
  label: string;
  detail: string;
  status: 'queued' | 'working' | 'completed';
}

const scenarioCopy: Record<PlaygroundScenario, { label: string; description: string }> = {
  'direct-task': {
    label: 'Direct task',
    description: 'Preview a sendMessage flow against a selected A2A agent.',
  },
  'streaming-task': {
    label: 'Streaming task',
    description: 'Simulate task status updates and artifact delivery over a live stream.',
  },
  'mcp-bridge': {
    label: 'MCP bridge',
    description: 'Show how a user request can route from A2A into MCP-backed tools.',
  },
};

function scenarioForAgent(agent: RegisteredAgent | null): PlaygroundScenario {
  if (agent?.card.capabilities?.mcpCompatible) {
    return 'mcp-bridge';
  }
  if (agent?.card.capabilities?.streaming) {
    return 'streaming-task';
  }
  return 'direct-task';
}

function buildTimeline(
  agent: RegisteredAgent,
  scenario: PlaygroundScenario,
  replayTaskId?: string | null,
): TimelineStep[] {
  const base: TimelineStep[] = [
    {
      label: 'Message composed',
      detail: `Targeting ${agent.card.name} over ${agent.card.transport ?? 'http'}.`,
      status: 'queued',
    },
    {
      label: 'Task submitted',
      detail: 'A2A sendMessage payload is ready for transport dispatch.',
      status: 'working',
    },
  ];

  if (replayTaskId) {
    base.push({
      label: 'Replay context loaded',
      detail: `Using task ${replayTaskId} as the operator investigation context.`,
      status: 'working',
    });
  }

  if (scenario === 'streaming-task') {
    base.push({
      label: 'Stream subscribed',
      detail: 'Task status updates are shown as they arrive from the registry stream.',
      status: 'working',
    });
  }

  if (scenario === 'mcp-bridge') {
    base.push({
      label: 'MCP bridge routed',
      detail: 'Tool context is mapped into the agent task before artifacts are returned.',
      status: 'working',
    });
  }

  base.push({
    label: 'Artifact preview ready',
    detail: 'The playground keeps this as a dry-run preview; no live agent call is made yet.',
    status: 'completed',
  });

  return base;
}

function buildPayload(
  agent: RegisteredAgent,
  scenario: PlaygroundScenario,
  message: string,
  replayTaskId?: string | null,
) {
  const metadata = {
    tenant: agent.tenantId ?? 'unassigned',
    ...(replayTaskId ? { replayTaskId } : {}),
    ...(scenario === 'mcp-bridge' ? { bridge: 'mcp', toolPolicy: 'read-only demo' } : {}),
  };

  return {
    jsonrpc: '2.0',
    method: scenario === 'streaming-task' ? 'message/stream' : 'message/send',
    params: {
      agentUrl: agent.url,
      mode: scenario,
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: message }],
      },
      metadata,
    },
    id: 'playground-preview-1',
  };
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function PlaygroundPanel({
  agents,
  tasks,
  selectedAgent,
  accessMode,
  replayTaskId,
  onSelectAgent,
}: PlaygroundPanelProps) {
  const playableAgents = useMemo(
    () => agents.filter((agent) => agent.status !== 'unhealthy'),
    [agents],
  );
  const activeAgent = selectedAgent ?? playableAgents[0] ?? agents[0] ?? null;
  const [scenario, setScenario] = useState<PlaygroundScenario>(() => scenarioForAgent(activeAgent));
  const [message, setMessage] = useState(
    'Summarize the latest registry health risks and propose the next operator action.',
  );
  const [hasRunPreview, setHasRunPreview] = useState(false);

  const visibleTasks = activeAgent ? tasks.filter((task) => task.agentId === activeAgent.id) : [];
  const payload = activeAgent ? buildPayload(activeAgent, scenario, message, replayTaskId) : null;
  const timeline = activeAgent ? buildTimeline(activeAgent, scenario, replayTaskId) : [];
  const hasLiveAccess = accessMode === 'authenticated';

  if (!activeAgent) {
    return (
      <section className="rounded-lg border border-white/10 bg-[#111820] p-6 text-center text-slate-300">
        <Sparkles className="mx-auto mb-3 text-cyan-200" />
        Register an agent to unlock the interactive playground preview.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-cyan-300/15 bg-[#111820] p-5">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-cyan-200">Playground</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Dry-run A2A task console</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Compose a sample message, preview the A2A payload, and walk through the task timeline
            before wiring this surface to a live agent endpoint.
          </p>
        </div>
        <span
          className={classNames(
            'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]',
            hasLiveAccess
              ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
              : 'border-amber-300/25 bg-amber-300/10 text-amber-100',
          )}
        >
          <Route size={14} />
          {hasLiveAccess ? 'operator dry run' : 'public preview'}
        </span>
      </div>

      {replayTaskId ? (
        <p className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
          Replay context: {replayTaskId}. This remains a dry-run preview and does not resubmit the
          task automatically.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-200">
            Target agent
            <select
              value={activeAgent.id}
              onChange={(event) => {
                const nextAgent = agents.find((agent) => agent.id === event.target.value);
                if (nextAgent) {
                  onSelectAgent(nextAgent);
                  setScenario(scenarioForAgent(nextAgent));
                  setHasRunPreview(false);
                }
              }}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.card.name} · {agent.status}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-sm font-medium text-slate-200">Scenario</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(Object.keys(scenarioCopy) as PlaygroundScenario[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setScenario(key);
                    setHasRunPreview(false);
                  }}
                  aria-pressed={scenario === key}
                  className={classNames(
                    'rounded-lg border px-3 py-3 text-left text-sm transition',
                    scenario === key
                      ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20',
                  )}
                >
                  <span className="font-semibold">{scenarioCopy[key].label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    {scenarioCopy[key].description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm font-medium text-slate-200">
            User message
            <textarea
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setHasRunPreview(false);
              }}
              rows={5}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-slate-950/45 px-3 py-3 text-sm leading-6 text-slate-100 outline-none focus:border-cyan-300/35"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHasRunPreview(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/12 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/50"
            >
              <Play size={16} />
              Run preview
            </button>
            <button
              type="button"
              onClick={() => {
                setMessage(
                  'Summarize the latest registry health risks and propose the next operator action.',
                );
                setScenario(scenarioForAgent(activeAgent));
                setHasRunPreview(false);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20"
            >
              <RefreshCw size={16} />
              Reset
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          <article className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MessageSquareText size={16} className="text-cyan-200" />
              Task timeline
            </div>
            <ol className="mt-4 space-y-3">
              {timeline.map((step, index) => (
                <li key={step.label} className="flex gap-3">
                  <span
                    className={classNames(
                      'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                      hasRunPreview || index < 2
                        ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-100'
                        : 'border-white/10 bg-white/5 text-slate-500',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-100">{step.label}</span>
                    <span className="mt-1 block text-sm leading-6 text-slate-400">
                      {step.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </article>

          <article className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Code2 size={16} className="text-cyan-200" />
              Payload preview
            </div>
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg border border-white/8 bg-black/25 p-3 text-xs leading-5 text-slate-200">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </article>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <SummaryCard label="Agent" value={activeAgent.card.name} detail={activeAgent.url} />
        <SummaryCard
          label="Capabilities"
          value={
            [
              activeAgent.card.capabilities?.streaming ? 'streaming' : null,
              activeAgent.card.capabilities?.mcpCompatible ? 'mcp' : null,
              activeAgent.card.capabilities?.pushNotifications ? 'push' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'basic'
          }
          detail="Used to preselect playground scenarios."
        />
        <SummaryCard
          label="Recent events"
          value={`${visibleTasks.length}`}
          detail="Task events available for this selected agent."
        />
      </div>
    </section>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}
