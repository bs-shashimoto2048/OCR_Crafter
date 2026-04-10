import { useState } from "react";

import Button from "./Button";

const modelCreationItems = [
  { id: "dashboard", label: "ダッシュボード" },
  { id: "images", label: "画像" },
  { id: "preprocess", label: "前処理設定" },
  { id: "labeling", label: "ラベル編集" },
  { id: "training", label: "学習" },
  { id: "models", label: "モデル" },
  { id: "inference", label: "推論" },
  { id: "evaluation", label: "評価" },
];

const imageCreationItems = [
  { id: "image-builder-step1", label: "1. 画像指定とリサイズ" },
  { id: "image-builder-step2", label: "2. YOLO検出" },
  { id: "image-builder-step3", label: "3. Bounding Box選択" },
  { id: "image-builder-step4", label: "4. クロップ出力" },
];

export default function Sidebar({ active, onChange, onExitApp }) {
  const [openTrees, setOpenTrees] = useState({
    modelCreation: true,
    imageCreation: true,
  });

  const treeSections = [
    { id: "modelCreation", label: "モデル作成", items: modelCreationItems },
    { id: "imageCreation", label: "学習画像作成", items: imageCreationItems },
  ];

  function toggleTree(treeId) {
    setOpenTrees((prev) => ({ ...prev, [treeId]: !prev[treeId] }));
  }

  return (
    <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-border/80 bg-[#2b3138]/90 px-5 py-6 backdrop-blur-xl">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">OCR プラットフォーム</p>
        <h1 className="mt-2 text-xl font-semibold text-text">OCR Crafter</h1>
      </div>

      <nav className="space-y-4">
        {treeSections.map((section) => (
          <div key={section.id}>
            <button
              type="button"
              onClick={() => toggleTree(section.id)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm font-semibold text-slate-200 transition hover:bg-[#37404a]/50"
            >
              <span>{section.label}</span>
              <span className="text-xs text-muted" aria-hidden="true">
                {openTrees[section.id] ? "▾" : "▸"}
              </span>
            </button>

            {openTrees[section.id] && (
              <div className="mt-1 space-y-1 pl-2">
                {section.items.map((item) => {
                  const isActive = active === item.id;
                  const isDisabled = Boolean(item.disabled);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (!isDisabled) {
                          onChange(item.id);
                        }
                      }}
                      disabled={isDisabled}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                        isDisabled
                          ? "cursor-not-allowed text-muted/55"
                          : isActive
                            ? "border border-border/90 bg-[#3c444f]/88 text-text shadow-[0_7px_20px_rgba(16,22,30,0.36)]"
                            : "text-muted hover:bg-[#37404a]/72 hover:text-text"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isDisabled ? "bg-muted/25" : isActive ? "bg-accent" : "bg-muted/40"
                        }`}
                        aria-hidden="true"
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
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
