function StatusIndicator({ status }) {
  if (status === "running" || status === "queued") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
        Training...
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success">
        <span className="h-2 w-2 rounded-full bg-success" />
        Success
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-xs font-medium text-danger">
        <span className="h-2 w-2 rounded-full bg-danger" />
        Failed
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
      <span className="h-2 w-2 rounded-full bg-muted/50" />
      Idle
    </div>
  );
}

export default function Header({ title, subtitle, status }) {
  return (
    <header className="flex items-start justify-between border-b border-border pb-5">
      <div>
        <h2 className="text-2xl font-semibold text-text">{title}</h2>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <StatusIndicator status={status} />
    </header>
  );
}
