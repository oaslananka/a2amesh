const styles: Record<string, { classes: string; dot: string }> = {
  IDLE: {
    classes: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  BUSY: { classes: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200', dot: 'bg-cyan-400' },
  OFFLINE: { classes: 'border-slate-400/20 bg-slate-400/10 text-slate-300', dot: 'bg-slate-400' },
  RUNNING: { classes: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200', dot: 'bg-cyan-400' },
  PENDING: { classes: 'border-amber-400/25 bg-amber-400/10 text-amber-200', dot: 'bg-amber-400' },
  COMPLETED: {
    classes: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  FAILED: { classes: 'border-rose-400/25 bg-rose-400/10 text-rose-200', dot: 'bg-rose-400' },
  CANCELED: { classes: 'border-slate-400/20 bg-slate-400/10 text-slate-300', dot: 'bg-slate-400' },
  NOT_REQUIRED: {
    classes: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
    dot: 'bg-slate-400',
  },
  APPROVED: {
    classes: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  REJECTED: { classes: 'border-rose-400/25 bg-rose-400/10 text-rose-200', dot: 'bg-rose-400' },
  EXPIRED: { classes: 'border-slate-400/20 bg-slate-400/10 text-slate-300', dot: 'bg-slate-400' },
};

function label(value: string): string {
  return value
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ');
}

export function StatusBadge({ status }: { status: string }) {
  const display = styles[status] ?? styles['NOT_REQUIRED'];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${display?.classes}`}
    >
      <span className={`h-2 w-2 rounded-full ${display?.dot}`} />
      {label(status)}
    </span>
  );
}
