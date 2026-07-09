function statusStyle(status) {
  if (status === "done") {
    return "border-success/40 bg-success/15 text-success";
  }
  if (status === "running") {
    return "border-accent/50 bg-accent/20 text-accent";
  }
  if (status === "error") {
    return "border-danger/50 bg-danger/15 text-danger";
  }
  if (status === "current") {
    return "border-accent/45 bg-accent/15 text-text";
  }
  return "border-border/70 bg-card/45 text-muted";
}

function dotStyle(status) {
  if (status === "done") return "bg-success";
  if (status === "running") return "bg-accent animate-pulse";
  if (status === "error") return "bg-danger";
  if (status === "current") return "bg-accent";
  return "bg-muted/50";
}

function StepContent({ step }) {
  return (
    <>
      <span className={`h-2 w-2 rounded-full ${dotStyle(step.status)}`} aria-hidden="true" />
      <span className="font-semibold">{step.label}</span>
      {step.meta ? <span className="text-[11px] opacity-90">{step.meta}</span> : null}
    </>
  );
}

// steps[].viewId があるステップはクリックで onNavigate(viewId) に遷移できる。
// viewId が無いステップは従来どおり表示のみ（単独画面を持たない工程用）。
export default function WorkflowProgress({ steps, activeView, onNavigate }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-card/50 p-3 backdrop-blur-md">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted">ワークフロー進行状況</p>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, idx) => {
          const clickable = Boolean(step.viewId && onNavigate);
          const isActive = Boolean(step.viewId && step.viewId === activeView);
          const boxClass = `inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${statusStyle(step.status)}`;
          return (
            <div key={step.id} className="flex items-center gap-2">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onNavigate(step.viewId)}
                  title={`${step.label} の画面へ移動`}
                  aria-label={`${step.label} の画面へ移動`}
                  aria-current={isActive ? "page" : undefined}
                  className={`${boxClass} cursor-pointer transition hover:border-accent/60 hover:bg-accent/10 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
                    isActive ? "ring-1 ring-accent/70" : ""
                  }`}
                >
                  <StepContent step={step} />
                </button>
              ) : (
                <div className={boxClass}>
                  <StepContent step={step} />
                </div>
              )}
              {idx < steps.length - 1 ? <span className="text-muted/70">→</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
