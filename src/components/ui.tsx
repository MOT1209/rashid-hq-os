import type { LogStatus, ProjectStatus } from "@/types/database";

const LOG_LED: Record<LogStatus, string> = {
  success: "bg-ok shadow-[0_0_8px_var(--ok)]",
  failed: "bg-err shadow-[0_0_8px_var(--err)]",
  pending: "bg-warn shadow-[0_0_8px_var(--warn)] led-pending",
};

/** Green / red / amber status light used across the activity views. */
export function StatusLed({ status }: { status: LogStatus }) {
  return (
    <span
      aria-label={status}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${LOG_LED[status]}`}
    />
  );
}

const PROJECT_BADGE: Record<ProjectStatus, string> = {
  active: "text-ok border-ok/40 bg-ok/10",
  idle: "text-muted border-border bg-panel-2",
  maintenance: "text-warn border-warn/40 bg-warn/10",
};

export function StatusBadge({ status, label }: { status: ProjectStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PROJECT_BADGE[status]}`}
    >
      {label}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-panel p-5 shadow-sm ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-panel p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-accent">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}
