import { useMemo, useState } from "react";

import { PROJECT_TEMPLATES, getTemplateById } from "../config/projectTemplates";
import Button from "./Button";

// テンプレート詳細（選択カードの下部に表示。作成前に適用内容を確認できる）
function TemplateDetail({ template }) {
  const rec = template.recommended || {};
  const preprocessCount = Object.keys(template.preprocessOverrides || {}).length;
  const rows = [
    ["OCRエンジン", template.recommendedEngine ? (template.recommendedEngine === "tesseract" ? "Tesseract（推奨）" : "PaddleOCR（推奨）") : "後から選択"],
    ["文字セット", template.characterSet || "標準（変更可能）"],
    [
      "前処理",
      preprocessCount === 0
        ? "標準設定のまま"
        : Object.entries(template.preprocessOverrides)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" / "),
    ],
    [
      "評価指標",
      rec.evaluation
        ? `主: ${rec.evaluation.primary === "cer" ? "CER" : "完全一致率"} / 補助: ${rec.evaluation.secondary === "cer" ? "CER" : "完全一致率"}`
        : "標準（CER・完全一致率）",
    ],
    ["YOLO使用", template.yoloEnabled ? "あり（領域検出→切り出し）" : "なし"],
    ["学習方式", rec.training || (template.recommendedEngine === "tesseract" ? "Tesseract LSTM fine-tune" : "標準")],
    ["推奨用途", (template.useCases || []).join(" / ")],
  ];
  return (
    <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2">
      <p className="mb-1 text-[12px] font-semibold text-muted">適用される設定（初期値。作成後はすべて変更できます）</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[12px] md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {(rec.notes || []).length ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11px] text-muted">
          {rec.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// テンプレート選択付き新規プロジェクト作成モーダル。
// フロー: ①テンプレート選択 → ②プロジェクト基本情報 → ③設定内容の確認 → 作成
export default function ProjectCreateModal({ onCreate, onClose, creating = false }) {
  const [step, setStep] = useState(0); // 0=テンプレート選択 1=基本情報 2=確認
  const [templateId, setTemplateId] = useState("standard");
  const [projectName, setProjectName] = useState("");
  const template = useMemo(() => getTemplateById(templateId), [templateId]);
  const steps = ["テンプレート選択", "プロジェクト基本情報", "設定内容の確認"];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="新規プロジェクト作成"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-[#2b3138] shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
          <h2 className="text-sm font-semibold text-text">
            新規プロジェクト <span className="ml-2 text-xs font-normal text-muted">{steps[step]}（{step + 1}/3）</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="新規プロジェクト作成を閉じる"
            className="rounded-lg px-2 py-1 text-base leading-none text-muted transition hover:bg-[#37404a]/72 hover:text-text"
          >
            ×
          </button>
        </div>

        <div className="dark-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 [overscroll-behavior:contain]">
          {step === 0 ? (
            <>
              {/* テンプレートカード（狭い画面=1列→2列→3列。横スクロールなし） */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" role="listbox" aria-label="プロジェクトテンプレート">
                {PROJECT_TEMPLATES.map((item) => {
                  const selected = item.id === templateId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-describedby={`template-desc-${item.id}`}
                      onClick={() => setTemplateId(item.id)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(88,166,255,0.4)]"
                          : "border-border/70 bg-card/50 hover:border-slate-400 hover:bg-card/70"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-label={`${item.name}のアイコン`}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold ${
                            selected ? "border-accent/60 bg-accent/20 text-blue-200" : "border-border/70 bg-card/60 text-muted"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className={`text-[13px] font-semibold ${selected ? "text-blue-200" : "text-text"}`}>{item.name}</span>
                      </span>
                      <span id={`template-desc-${item.id}`} className="text-[11px] leading-relaxed text-muted">
                        {item.description}
                      </span>
                      <span className="mt-auto flex flex-wrap gap-1 pt-1">
                        {item.recommendedEngine ? (
                          <span className="rounded-full border border-border/70 bg-card/60 px-1.5 py-0.5 text-[10px] text-muted">
                            {item.recommendedEngine === "tesseract" ? "Tesseract" : "PaddleOCR"}
                          </span>
                        ) : null}
                        {(item.tags || []).slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full border border-border/70 bg-card/60 px-1.5 py-0.5 text-[10px] text-muted">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <span className={`mt-1 text-[11px] font-medium ${selected ? "text-accent" : "text-muted"}`}>
                        {selected ? "✓ 選択中" : "このテンプレートを使用"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <TemplateDetail template={template} />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="text-[13px] font-semibold text-text">プロジェクト基本情報</p>
              <label className="block text-[12px] text-muted">
                プロジェクト名 <span className="text-danger">*</span>
                <input
                  autoFocus
                  className="app-input mt-1 h-9 w-full text-sm"
                  placeholder="例: nameplate_2026"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && projectName.trim()) {
                      e.preventDefault();
                      setStep(2);
                    }
                  }}
                  aria-required="true"
                />
              </label>
              <p className="text-[11px] text-muted">
                選択中のテンプレート: <span className="text-text">{template.name}</span>（作成後もすべての設定を変更できます）
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-[13px] font-semibold text-text">設定内容の確認</p>
              <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-[12px]">
                <p>
                  <span className="text-muted">プロジェクト名: </span>
                  <span className="font-semibold text-text">{projectName.trim() || "-"}</span>
                </p>
                <p className="mt-0.5">
                  <span className="text-muted">テンプレート: </span>
                  <span className="text-text">
                    {template.name}（v{template.version}）
                  </span>
                </p>
              </div>
              <TemplateDetail template={template} />
              {(template.guidance || []).length ? (
                <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[11px] text-muted">
                  <p className="mb-0.5 font-semibold text-blue-200">作成後の推奨手順</p>
                  {template.guidance.map((line) => (
                    <p key={line}>・{line}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/70 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            戻る
          </Button>
          {step < 2 ? (
            <Button size="sm" onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !projectName.trim()} title={step === 1 && !projectName.trim() ? "プロジェクト名は必須です" : ""}>
              次へ
            </Button>
          ) : (
            <Button size="sm" onClick={() => onCreate?.(projectName.trim(), template)} disabled={creating || !projectName.trim()}>
              {creating ? "作成中..." : "作成"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
