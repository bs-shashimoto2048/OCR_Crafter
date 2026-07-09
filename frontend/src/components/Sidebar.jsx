import { useState } from "react";

import Button from "./Button";

const modelCreationItems = [
  { id: "dashboard", label: "1. ダッシュボード" },
  { id: "images", label: "2. 画像" },
  { id: "preprocess", label: "3. 前処理設定" },
  { id: "labeling", label: "4. ラベル編集" },
  {
    type: "group",
    id: "ocr-training-group",
    label: "学習 > OCR認識モデル",
    items: [
      { id: "ocr-training", label: "1. データ作成・学習" },
      { id: "ocr-models", label: "2. モデル管理" },
      { id: "ocr-inference", label: "3. 推論" },
      { id: "rapid-ocr", label: "4. OCR修正" },
      { id: "ocr-batch", label: "5. バッチ推論" },
      { id: "ocr-eval", label: "6. モデル評価" },
    ],
  },
  {
    type: "group",
    id: "cls-training-group",
    label: "学習 > 分割学習モデル",
    items: [
      { id: "cls-training", label: "1. 前処理・データセット作成・学習" },
      { id: "cls-models", label: "2. 分類モデル管理" },
      { id: "cls-inference", label: "3. 分類推論" },
      { id: "cls-evaluation", label: "4. 分類評価" },
    ],
  },
];

const imageCreationItems = [
  { id: "image-builder-step1", label: "1. 画像指定とリサイズ" },
  { id: "image-builder-step2", label: "2. YOLO検出" },
  { id: "image-builder-step3", label: "3. Bounding Box選択" },
  { id: "image-builder-step4", label: "4. クロップ出力" },
];

export default function Sidebar({ active, onChange, onExitApp, collapsed = false, onToggleCollapse }) {
  const [openTrees, setOpenTrees] = useState({
    modelCreation: true,
    imageCreation: true,
  });
  const [openGroups, setOpenGroups] = useState({
    "ocr-training-group": false,
    "cls-training-group": false,
  });

  const activeLabel =
    [...modelCreationItems, ...imageCreationItems]
      .flatMap((item) => (item.type === "group" ? item.items : [item]))
      .find((item) => item.id === active)?.label || "";

  const treeSections = [
    { id: "modelCreation", label: "モデル作成", items: modelCreationItems },
    { id: "imageCreation", label: "学習画像作成", items: imageCreationItems },
  ];

  function toggleTree(treeId) {
    setOpenTrees((prev) => ({ ...prev, [treeId]: !prev[treeId] }));
  }

  function toggleGroup(groupId) {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  if (collapsed) {
    return (
      <aside className="fixed inset-y-0 left-0 flex w-14 flex-col items-center border-r border-border/80 bg-[#2b3138]/90 px-2 py-4 backdrop-blur-xl transition-[width] duration-200">
        <button
          type="button"
          onClick={() => onToggleCollapse?.()}
          title="サイドバーを展開"
          aria-label="サイドバーを展開"
          aria-expanded="false"
          className="rounded-lg px-2 py-1.5 text-base leading-none text-muted transition hover:bg-[#37404a]/72 hover:text-text"
        >
          ▶
        </button>
        <div
          className="mt-4 flex min-h-0 flex-1 flex-col items-center overflow-hidden"
          title={activeLabel ? `現在の画面: ${activeLabel}` : undefined}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <span className="mt-2 select-none text-xs font-medium tracking-[0.14em] text-slate-300/90 [writing-mode:vertical-rl]">
            {activeLabel}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-border/80 bg-[#2b3138]/90 px-5 py-6 backdrop-blur-xl transition-[width] duration-200">
      <div className="mb-8 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">OCR プラットフォーム</p>
          <h1 className="mt-2 text-xl font-semibold text-text">OCR Crafter</h1>
        </div>
        <button
          type="button"
          onClick={() => onToggleCollapse?.()}
          title="サイドバーを折り畳む"
          aria-label="サイドバーを折り畳む"
          aria-expanded="true"
          className="rounded-lg px-2 py-1.5 text-base leading-none text-muted transition hover:bg-[#37404a]/72 hover:text-text"
        >
          ◀
        </button>
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
              <span className="text-2xl font-semibold leading-none text-muted" aria-hidden="true">
                {openTrees[section.id] ? "▾" : "▸"}
              </span>
            </button>

            {openTrees[section.id] && (
              <div className="mt-1 space-y-1 pl-2">
                {section.items.map((item) => {
                  if (item.type === "group") {
                    const isOpen = Boolean(openGroups[item.id]);
                    return (
                      <div key={`${section.id}-${item.id}`} className="pt-2">
                        <button
                          type="button"
                          onClick={() => toggleGroup(item.id)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold tracking-[0.04em] text-slate-300/90 transition hover:bg-[#37404a]/50"
                        >
                          <span>{item.label}</span>
                          <span className="text-2xl font-semibold leading-none text-muted" aria-hidden="true">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </button>
                        {isOpen ? (
                          <div className="mt-1 space-y-1 pl-2">
                            {item.items.map((subItem) => {
                              const isActive = active === subItem.id;
                              const isDisabled = Boolean(subItem.disabled);
                              return (
                                <button
                                  key={subItem.id}
                                  type="button"
                                  onClick={() => {
                                    if (!isDisabled) {
                                      onChange(subItem.id);
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
                                  <span className={isActive ? "sidebar-active-wave" : ""}>{subItem.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }
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
                      <span className={isActive ? "sidebar-active-wave" : ""}>{item.label}</span>
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
