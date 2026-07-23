import { useEffect, useState } from "react";

import { request } from "../lib/api";
import { WIZARD_STEPS } from "../lib/setupWizard";
import Button from "./Button";

// 環境チェックの状態表示（✓利用可能 / 未インストール / 確認中）
function CheckRow({ ok, label, detail, okText = "✓ 利用可能", ngText = "未インストール" }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
      <span className={`mt-0.5 shrink-0 text-sm ${ok === true ? "text-success" : ok === false ? "text-amber-200" : "text-muted"}`}>
        {ok === true ? "✓" : ok === false ? "△" : "…"}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] text-text">
          {label}
          <span className={`ml-2 text-[12px] ${ok === true ? "text-success" : ok === false ? "text-amber-200" : "text-muted"}`}>
            {ok === null || ok === undefined ? "確認中..." : ok ? okText : ngText}
          </span>
        </p>
        {detail ? <p className="mt-0.5 break-all text-[11px] text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

// 初回セットアップウィザード（モーダル）。
// - Escでは終了しない（誤操作防止）。右上×のみ確認つきで終了できる
// - onComplete(projectsDir): 完了フラグ保存は呼び出し側（App）で行う
// - onCancel: 完了フラグを立てずに閉じる（次回起動時に再表示される）
// - initialStep はテスト用（既定0=ようこそ）
export default function SetupWizard({ onComplete, onCancel, initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [system, setSystem] = useState(null);
  const [browsedDir, setBrowsedDir] = useState("");
  const [browseError, setBrowseError] = useState("");

  // 環境チェック（保存先・エンジン・GPU・Python環境で共用）
  useEffect(() => {
    request("/health/details").then(setHealth).catch(() => setHealth({ checks: {} }));
    request("/health/ready").then(setReady).catch(() => setReady({ ready: false, checks: {} }));
    request("/api/system/check").then(setSystem).catch(() => setSystem({}));
  }, []);

  // Escでは終了しない（keydownを吸収）。終了は右上×のみ
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const checks = health?.checks || {};
  const projectsDirCurrent = String(checks.projects_dir?.detail || "");
  const dataWritable = ready?.checks ? Boolean(ready.checks.data_dir_writable) : null;

  async function browseDirectory() {
    setBrowseError("");
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (data?.path) setBrowsedDir(String(data.path));
    } catch (error) {
      setBrowseError(`フォルダ選択に失敗しました: ${error.message}`);
    }
  }

  function requestClose() {
    if (window.confirm("セットアップを中断しますか？（次回起動時に再度表示されます）")) {
      onCancel?.();
    }
  }

  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="初回セットアップウィザード"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-[#2b3138] shadow-2xl">
        {/* ヘッダー: タイトル＋右上×（確認つき終了。Escでは閉じない） */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
          <h2 className="text-sm font-semibold text-text">初回セットアップ</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="セットアップを中断（確認あり）"
            title="中断（次回起動時に再表示）"
            className="rounded-lg px-2 py-1 text-base leading-none text-muted transition hover:bg-[#37404a]/72 hover:text-text"
          >
            ×
          </button>
        </div>

        {/* ステップバー */}
        <div className="flex items-center gap-1 border-b border-border/50 px-5 py-2.5" aria-label={`ステップ ${step + 1} / ${WIZARD_STEPS.length}`}>
          {WIZARD_STEPS.map((item, index) => (
            <div key={item.id} className="flex min-w-0 flex-1 items-center gap-1">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  index < step
                    ? "bg-success/25 text-success"
                    : index === step
                      ? "bg-accent text-white"
                      : "border border-border/70 text-muted"
                }`}
                aria-hidden="true"
              >
                {index < step ? "✓" : index + 1}
              </span>
              <span className={`hidden truncate text-[10px] sm:block ${index === step ? "font-semibold text-text" : "text-muted"}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* 本文 */}
        <div className="dark-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 [overscroll-behavior:contain]">
          {step === 0 ? (
            <div className="py-4 text-center">
              <p className="text-lg font-semibold text-text">OCR Crafterへようこそ</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                セットアップは数分で完了します。
                <br />
                必要な設定だけを順番に確認します（あとから「システム状態」画面でいつでも再実行できます）。
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <p className="text-[13px] font-semibold text-text">プロジェクト保存先</p>
              <p className="text-[12px] text-muted">画像・ラベル・モデルなどの全データはプロジェクト単位でこの場所へ保存されます。</p>
              <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                <p className="text-[11px] text-muted">デフォルト保存先（現在の設定）</p>
                <p className="mt-0.5 break-all text-[12px] text-text">{projectsDirCurrent || "確認中..."}</p>
              </div>
              <CheckRow
                ok={dataWritable}
                label="書き込み確認"
                okText="✓ 書き込み可能"
                ngText="書き込みできません"
                detail={dataWritable === false ? "保存先フォルダの権限を確認してください（docs/24 データディレクトリ権限）" : ""}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={browseDirectory}>
                  Browse...
                </Button>
                {browsedDir ? <span className="min-w-0 break-all text-[11px] text-muted">候補: {browsedDir}</span> : null}
              </div>
              {browseError ? <p className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[12px] text-danger">{browseError}</p> : null}
              <p className="text-[11px] leading-relaxed text-muted">
                保存先を変更する場合は <code className="text-slate-300">config/settings.yaml</code> の <code className="text-slate-300">paths.data_projects</code>{" "}
                を編集してBackendを再起動してください（Browseで選んだ候補はメモとして保存されます）。
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-[13px] font-semibold text-text">OCRエンジンの確認</p>
              <p className="text-[12px] text-muted">未インストールでもセットアップは続行できます（あとから導入可能）。</p>
              <CheckRow ok={health ? Boolean(checks.tesseract?.ok) : null} label="Tesseract" detail={checks.tesseract?.detail} />
              <CheckRow ok={health ? Boolean(checks.paddleocr?.ok) : null} label="PaddleOCR" detail={checks.paddleocr?.detail} />
              {health && !checks.tesseract?.ok ? (
                <p className="text-[11px] text-muted">Tesseractの導入手順: docs/11_TESSERACT_CHECKLIST.md（UB-Mannheimビルド推奨）</p>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-[13px] font-semibold text-text">GPUの確認</p>
              <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-[12px]">
                <p className="text-muted">
                  GPU名: <span className="text-text">{system ? system.gpu_name || "検出なし" : "確認中..."}</span>
                  {system?.vram_gb ? <span className="ml-1 text-muted">（VRAM {system.vram_gb}GB）</span> : null}
                </p>
                <p className="mt-1 text-muted">
                  CUDA利用可否:{" "}
                  <span className={system?.gpu_available ? "text-success" : "text-amber-200"}>
                    {system ? (system.gpu_available ? "✓ 利用可能" : "利用不可") : "確認中..."}
                  </span>
                </p>
                <p className="mt-1 text-success">✓ CPUでも実行できます（GPUがなくても続行可能）</p>
              </div>
              {system && !system.gpu_available ? (
                <p className="text-[11px] text-muted">学習はCPUでも動作します（時間がかかる場合はイテレーション数を調整してください）。</p>
              ) : null}
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="text-[13px] font-semibold text-text">Python環境の確認</p>
              <CheckRow ok={health ? Boolean(checks.backend?.ok) : null} label="Python / Backend" okText="✓ 稼働中" ngText="応答なし" detail={checks.backend?.detail} />
              <CheckRow
                ok={health ? Boolean(checks.settings?.ok) : null}
                label="設定ファイル（settings.yaml）"
                okText="✓ 読み込み可能"
                ngText="読み込みエラー"
                detail={checks.settings?.detail}
              />
              <CheckRow
                ok={health ? Boolean(checks.paddleocr?.ok) : null}
                label="必要ライブラリ（PaddleOCR等）"
                okText="✓ 導入済み"
                ngText="一部未導入"
                detail={checks.paddleocr?.ok ? "" : "pip install -r requirements.txt で導入できます（未導入でもTesseractのみで利用可能）"}
              />
              {health?.problems?.length ? (
                <p className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[12px] text-amber-200">
                  注意が必要な項目: {health.problems.join(" / ")}（詳細は「運用 &gt; システム状態」で確認できます）
                </p>
              ) : null}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <p className="text-[13px] font-semibold text-text">バックアップの推奨設定</p>
              <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-[12px] text-muted">
                <p>
                  保存先: <span className="text-text">data/backups/</span>（NAS・別ドライブへの定期コピーを推奨）
                </p>
                <p className="mt-1.5">推奨頻度（初期値）:</p>
                <ul className="ml-4 mt-0.5 list-disc space-y-0.5">
                  <li>
                    <span className="text-text">metadata（設定・記録のみ）: 毎日</span>
                  </li>
                  <li>
                    <span className="text-text">full（プロジェクト全体）: 毎週</span>
                  </li>
                </ul>
                <p className="mt-1.5">バックアップの作成・復元は「運用 &gt; システム状態」のバックアップカードから実行できます。</p>
              </div>
            </>
          ) : null}

          {step === 6 ? (
            <div className="py-2 text-center">
              <p className="text-lg font-semibold text-success">セットアップ完了</p>
              <p className="mt-1 text-[12px] text-muted">OCR Crafterを使い始めましょう。</p>
              <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2">
                <Button onClick={() => onComplete?.({ projectsDir: browsedDir, navigateTo: "dashboard" })}>新規プロジェクト</Button>
                <Button variant="secondary" onClick={() => onComplete?.({ projectsDir: browsedDir, navigateTo: "dashboard" })}>
                  プロジェクトを開く
                </Button>
                <Button variant="secondary" onClick={() => onComplete?.({ projectsDir: browsedDir, navigateTo: "image-builder-step1" })}>
                  サンプルを見る（最初の工程へ）
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* フッター: 戻る / 次へ / 完了 */}
        <div className="flex items-center justify-between border-t border-border/70 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            戻る
          </Button>
          {isLast ? (
            <Button size="sm" onClick={() => onComplete?.({ projectsDir: browsedDir, navigateTo: "" })}>
              完了
            </Button>
          ) : (
            <Button size="sm" onClick={() => setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}>
              次へ
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
