import Button from "./Button";

const navItems = [
  { id: "dashboard", label: "ダッシュボード" },
  { id: "images", label: "画像" },
  { id: "preprocess", label: "前処理調整" },
  { id: "labeling", label: "ラベル編集" },
  { id: "training", label: "学習" },
  { id: "models", label: "モデル" },
  { id: "inference", label: "推論" },
  { id: "evaluation", label: "評価" },
];

export default function Sidebar({ active, onChange, onExitApp }) {
  return (
    <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-[#27313c] px-5 py-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">OCR プラットフォーム</p>
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

      <div className="mt-auto border-t border-border pt-4">
        <Button
          variant="danger"
          className="w-full whitespace-nowrap"
          onClick={() => onExitApp?.()}
          type="button"
        >
          アプリ終了
        </Button>
      </div>
    </aside>
  );
}
