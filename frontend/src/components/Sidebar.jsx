const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "images", label: "Images" },
  { id: "labeling", label: "Labeling" },
  { id: "training", label: "Training" },
  { id: "models", label: "Models" },
  { id: "inference", label: "Inference" },
];

export default function Sidebar({ active, onChange }) {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-border bg-[#27313c] px-5 py-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">OCR Platform</p>
        <h1 className="mt-2 text-xl font-semibold text-text">OCR Crafter</h1>
      </div>

      <nav className="space-y-1">
        {navItems.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-[#3a4654] text-text border border-border"
                  : "text-muted hover:bg-[#36414e] hover:text-text"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${isActive ? "bg-accent" : "bg-muted/40"}`}
                aria-hidden="true"
              />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
