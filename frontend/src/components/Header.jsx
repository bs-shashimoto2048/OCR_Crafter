function StatusIndicator({ status }) {
  if (status === "running" || status === "queued") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-medium text-accent">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        学習中...
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success">
        <span className="h-2 w-2 rounded-full bg-success" />
        成功
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-xs font-medium text-danger">
        <span className="h-2 w-2 rounded-full bg-danger" />
        失敗
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
      <span className="h-2 w-2 rounded-full bg-muted/50" />
      待機中
    </div>
  );
}

export default function Header({ title, subtitle, status, labelProgress }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border pb-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {labelProgress ? (
          <p className="text-sm font-medium text-lime-300">
            {labelProgress.labeled} / {labelProgress.total}
          </p>
        ) : null}
        <StatusIndicator status={status} />
      </div>
    </header>
  );
}
