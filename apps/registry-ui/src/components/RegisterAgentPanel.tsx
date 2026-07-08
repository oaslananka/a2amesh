import { Lock, RefreshCw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import {
  registerAgent,
  RegistryApiError,
  type RegisteredAgent,
  type RegistryAccessMode,
} from '../api/registry';

interface RegisterAgentPanelProps {
  accessMode: RegistryAccessMode;
  onRegistered: (agent: RegisteredAgent) => void;
}

const emptyForm = {
  agentUrl: '',
  name: '',
  description: '',
  version: '1.0.0',
  tenantId: '',
  isPublic: true,
};

export function RegisterAgentPanel({ accessMode, onRegistered }: RegisterAgentPanelProps) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (accessMode !== 'authenticated') {
    return (
      <section className="rounded-lg border border-white/10 bg-[#111820] p-6 text-center text-slate-300">
        <Lock className="mx-auto mb-3 text-amber-200" />
        Registering agents requires operator authentication.
      </section>
    );
  }

  const canSubmit =
    form.agentUrl.trim() !== '' &&
    form.name.trim() !== '' &&
    form.description.trim() !== '' &&
    form.version.trim() !== '';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const registered = await registerAgent({
        agentUrl: form.agentUrl.trim(),
        agentCard: {
          protocolVersion: '1.0',
          name: form.name.trim(),
          description: form.description.trim(),
          url: form.agentUrl.trim(),
          version: form.version.trim(),
        },
        ...(form.tenantId.trim() ? { tenantId: form.tenantId.trim() } : {}),
        isPublic: form.isPublic,
      });
      setSuccessMessage(`Registered ${registered.card.name}.`);
      setForm(emptyForm);
      onRegistered(registered);
    } catch (submitError) {
      setError(
        submitError instanceof RegistryApiError ? submitError.message : 'Failed to register agent.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-cyan-300/15 bg-[#111820] p-5">
      <div className="border-b border-white/8 pb-5">
        <p className="text-[11px] uppercase tracking-[0.32em] text-cyan-200">Register</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Register a new agent</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          Add an agent to the registry by URL and Agent Card metadata. The registry begins
          health-checking it immediately after registration.
        </p>
      </div>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="mt-5 grid gap-4 sm:grid-cols-2"
      >
        <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
          Agent URL
          <input
            type="url"
            required
            value={form.agentUrl}
            onChange={(event) => setForm({ ...form, agentUrl: event.target.value })}
            placeholder="http://localhost:4001"
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block text-sm font-medium text-slate-200">
          Name
          <input
            type="text"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block text-sm font-medium text-slate-200">
          Version
          <input
            type="text"
            required
            value={form.version}
            onChange={(event) => setForm({ ...form, version: event.target.value })}
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
          Description
          <textarea
            required
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={3}
            className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-slate-950/45 px-3 py-3 text-sm leading-6 text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="block text-sm font-medium text-slate-200">
          Tenant ID (optional)
          <input
            type="text"
            value={form.tenantId}
            onChange={(event) => setForm({ ...form, tenantId: event.target.value })}
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/35"
          />
        </label>

        <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium text-slate-200">
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            className="h-4 w-4 rounded border-white/20 bg-slate-950/45"
          />
          Public agent
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/12 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <RefreshCw size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {submitting ? 'Registering…' : 'Register agent'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">
          {successMessage}
        </p>
      ) : null}
    </section>
  );
}
