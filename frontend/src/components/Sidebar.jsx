import { useState } from "react";

import Button from "./Button";

// セクションアイコン（Heroicons outline のSVGパスをインライン化。依存パッケージは追加しない）
function SectionIcon({ name, className = "h-4 w-4" }) {
  const paths = {
    // フォルダ（プロジェクト）
    folder:
      "M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z",
    // 画像（データ作成）
    photo:
      "m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z",
    // CPUチップ（OCRモデル）
    chip: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z",
    // 歯車（運用）
    cog: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    // ビーカー（実験機能）
    beaker:
      "M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

// OCRモデル開発フロー順のサイドバー構成。
// 機能一覧ではなく作業工程（プロジェクト確認→データ作成→OCRモデル→実験機能）を表す。
// 新機能はカテゴリ名を変えずに各セクションの items へ追加する（例: Data Augmentation→データ作成）。
export const SIDEBAR_SECTIONS = [
  {
    id: "project",
    label: "プロジェクト",
    icon: "folder",
    description: "プロジェクト概要・進行状況・統計を確認します。",
    defaultOpen: true,
    items: [{ id: "dashboard", label: "ダッシュボード" }],
  },
  {
    id: "data-creation",
    label: "データ作成",
    icon: "photo",
    description: "OCR学習に必要な画像・ラベル・評価データを準備します。",
    defaultOpen: true,
    items: [
      // 開発フロー順（画像取得→YOLO検出→BBox選択→クロップ→画像確認→前処理→ラベル→評価データ）。並び順を変えないこと
      { id: "image-builder-step1", label: "画像指定・リサイズ" },
      { id: "image-builder-step2", label: "YOLO検出" },
      { id: "image-builder-step3", label: "Bounding Box選択" },
      { id: "image-builder-step4", label: "クロップ出力" },
      { id: "images", label: "画像" },
      { id: "preprocess", label: "前処理設定" },
      { id: "labeling", label: "ラベル編集" },
      { id: "image-builder-step5", label: "評価データ作成" },
    ],
  },
  {
    id: "ocr-model",
    label: "OCRモデル",
    icon: "chip",
    description: "学習・評価・推論・モデル管理を行います。",
    defaultOpen: true,
    items: [
      // 学習→管理→評価（性能確認）→推論→修正→バッチの順
      { id: "ocr-training", label: "データ作成・学習" },
      { id: "ocr-models", label: "モデル管理" },
      { id: "experiments", label: "実験管理" },
      { id: "releases", label: "リリース管理" },
      { id: "ocr-eval", label: "モデル評価" },
      { id: "ocr-inference", label: "推論" },
      { id: "rapid-ocr", label: "OCR修正" },
      { id: "ocr-batch", label: "バッチ推論" },
    ],
  },
  {
    id: "operations",
    label: "運用",
    icon: "cog",
    description: "ジョブ・監査・システム状態などの運用管理を行います。",
    defaultOpen: false,
    items: [
      { id: "jobs", label: "ジョブ管理" },
      { id: "benchmark", label: "Benchmark" },
    ],
  },
  {
    id: "experimental",
    label: "実験機能",
    icon: "beaker",
    description: "分類モデルなど通常ワークフロー外の実験的な機能です。",
    defaultOpen: false,
    items: [
      { id: "cls-training", label: "分類学習" },
      { id: "cls-models", label: "分類モデル管理" },
      { id: "cls-inference", label: "分類推論" },
      { id: "cls-evaluation", label: "分類評価" },
    ],
  },
];

export default function Sidebar({ active, onChange, onExitApp, collapsed = false, onToggleCollapse }) {
  // 展開状態（初期: プロジェクト/データ作成/OCRモデル=展開・実験機能=折りたたみ）
  const [openSections, setOpenSections] = useState(() =>
    Object.fromEntries(SIDEBAR_SECTIONS.map((section) => [section.id, section.defaultOpen]))
  );

  const activeLabel =
    SIDEBAR_SECTIONS.flatMap((section) => section.items).find((item) => item.id === active)?.label || "";

  function toggleSection(sectionId) {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
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
      <div className="mb-6 flex items-start justify-between gap-2">
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

      <nav className="dark-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 [overscroll-behavior:contain]">
        {SIDEBAR_SECTIONS.map((section) => {
          const isOpen = Boolean(openSections[section.id]);
          // 選択中ページの所属セクションはヘッダー（アイコン・文字色）もアクティブ表示
          const sectionActive = section.items.some((item) => item.id === active);
          return (
            <div key={section.id} className="border-b border-border/40 pb-2 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                title={section.description}
                aria-expanded={isOpen}
                data-section={section.id}
                data-active={sectionActive ? "true" : "false"}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition hover:bg-[#37404a]/50 ${
                  sectionActive ? "text-accent" : "text-slate-200"
                }`}
              >
                <SectionIcon name={section.icon} />
                <span className="flex-1">{section.label}</span>
                <span className="text-xl font-semibold leading-none text-muted" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>

              {isOpen ? (
                <div className="mt-1 space-y-0.5 pl-2">
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
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          isDisabled
                            ? "cursor-not-allowed text-muted/55"
                            : isActive
                              ? "border border-border/90 bg-[#3c444f]/88 text-text shadow-[0_7px_20px_rgba(16,22,30,0.36)]"
                              : "text-muted hover:bg-[#37404a]/72 hover:text-text"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isDisabled ? "bg-muted/25" : isActive ? "bg-accent" : "bg-muted/40"
                          }`}
                          aria-hidden="true"
                        />
                        <span className={isActive ? "sidebar-active-wave" : ""}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
