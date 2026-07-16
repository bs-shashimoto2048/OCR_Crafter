import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import Button from "../components/Button";
import Card from "../components/Card";
import { API_BASE, request } from "../lib/api";
import {
  computeEvalCounts,
  cropKey,
  EVAL_SERIES_ALL,
  evaluateCreateReadiness,
  filterEvalItems,
  nextRotation,
} from "../lib/evaluationBuilder";
import { decideNextImageIndex } from "../lib/labelNavigation";

const LIST_ROW_HEIGHT = 56;

// 評価候補クロップの画像URL（回転はサーバー側でその場適用。rotationがURLへ入るため対象行だけ再取得される）
function cropImageUrl(projectId, item, rotation, maxSide = 0) {
  const params = new URLSearchParams({
    project_id: projectId || "default",
    export_id: item.exportId,
    filename: item.filename,
    rotation: String(rotation || 0),
  });
  if (maxSide > 0) {
    params.set("max_side", String(maxSide));
  }
  return `${API_BASE}/image-builder/evaluation/crop?${params.toString()}`;
}

// 一覧の1行（memo化: 対象行のstate変更時のみ再描画し、1000件でも回転・入力が全件再描画にならない）
const EvalListRow = memo(function EvalListRow({ projectId, item, state, isCurrent, onSelect, onToggleChecked }) {
  const label = String(state.label || "");
  const rotation = nextRotation(state.rotation, 0);
  const checked = state.checked !== false;
  return (
    <div
      onClick={() => onSelect(item.key)}
      className={`flex h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-2 text-xs ${
        isCurrent ? "border-accent/80 bg-accent/10 ring-1 ring-accent/50" : "border-border/70 bg-card/45 hover:bg-card/70"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleChecked(item.key)}
        title={checked ? "評価対象から外す" : "評価対象にする"}
      />
      {item.exists === false ? (
        <span className="flex h-10 w-20 shrink-0 items-center justify-center rounded border border-danger/50 text-[10px] text-danger">
          画像なし
        </span>
      ) : (
        <img
          src={cropImageUrl(projectId, item, rotation, 160)}
          alt={item.filename}
          className="h-10 w-20 shrink-0 rounded border border-border/60 bg-card object-contain"
          loading="lazy"
        />
      )}
      <span className="w-20 shrink-0 truncate text-muted" title={item.series}>
        {item.series || "-"}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text" title={`${item.exportId}/${item.filename}`}>
        {item.filename}
      </span>
      <span className={`min-w-0 flex-1 truncate ${label.trim() ? "font-semibold text-text" : "text-amber-100"}`}>
        {label.trim() ? label : "未入力"}
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums text-muted">{rotation ? `${rotation}°` : "-"}</span>
    </div>
  );
});

export default function EvaluationDatasetBuilder({ projectId, stepProgress, onStepChange }) {
  const [items, setItems] = useState([]);
  const [exportsInfo, setExportsInfo] = useState([]);
  // 画像単位の編集状態: {label, rotation, checked}。バックエンドの editing_state.json と同期
  const [itemState, setItemState] = useState({});
  const [currentKey, setCurrentKey] = useState("");
  const [seriesFilter, setSeriesFilter] = useState(EVAL_SERIES_ALL);
  const [unlabeledOnly, setUnlabeledOnly] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stateLoadedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const labelInputRef = useRef(null);

  function setOk(text) {
    setMessage(text);
    setError("");
  }

  function setFail(text) {
    setError(text);
    setMessage("");
  }

  // 候補（Step4出力マニフェスト）と途中保存状態の読み込み。プロジェクト切替で全て入れ替える
  useEffect(() => {
    let ignore = false;
    stateLoadedRef.current = false;
    setItems([]);
    setExportsInfo([]);
    setItemState({});
    setCurrentKey("");
    setSeriesFilter(EVAL_SERIES_ALL);
    setUnlabeledOnly(false);
    setDatasetName("");
    setCreatedResult(null);
    setMessage("");
    setError("");
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const [candidates, stateRes] = await Promise.all([
          request(`/image-builder/evaluation/candidates?project_id=${encodeURIComponent(projectId)}`),
          request(`/image-builder/evaluation/state?project_id=${encodeURIComponent(projectId)}`),
        ]);
        if (ignore) return;
        const flat = [];
        for (const exp of candidates?.exports || []) {
          for (const crop of exp.crops || []) {
            flat.push({
              key: cropKey(crop.export_id, crop.filename),
              exportId: crop.export_id,
              filename: crop.filename,
              series: crop.series || "",
              bboxId: crop.bbox_id ?? null,
              exists: crop.exists !== false,
              sourceImage: exp.source_image || "",
              createdAt: exp.created_at || "",
            });
          }
        }
        setItems(flat);
        setExportsInfo(candidates?.exports || []);
        const saved = stateRes?.state || {};
        setItemState(saved.items && typeof saved.items === "object" ? saved.items : {});
        setSeriesFilter(typeof saved.seriesFilter === "string" ? saved.seriesFilter : EVAL_SERIES_ALL);
        setUnlabeledOnly(Boolean(saved.unlabeledOnly));
        setDatasetName(typeof saved.datasetName === "string" ? saved.datasetName : "");
        const savedCurrent = typeof saved.currentKey === "string" ? saved.currentKey : "";
        setCurrentKey(savedCurrent && flat.some((row) => row.key === savedCurrent) ? savedCurrent : flat[0]?.key || "");
        stateLoadedRef.current = true;
      } catch (e) {
        if (!ignore) {
          setFail(`評価候補の読み込みに失敗しました: ${e.message}`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  // 途中保存（editing_state.json）。連続編集をまとめるため800msデバウンス
  useEffect(() => {
    if (!stateLoadedRef.current || !projectId) {
      return undefined;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      request("/image-builder/evaluation/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          state: { items: itemState, currentKey, seriesFilter, unlabeledOnly, datasetName },
        }),
      }).catch(() => {
        // 途中保存失敗は編集継続を妨げない（作成時に改めてエラー表示される）
      });
    }, 800);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [projectId, itemState, currentKey, seriesFilter, unlabeledOnly, datasetName]);

  const seriesOptions = useMemo(() => {
    const set = new Set(items.map((row) => row.series).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visibleItems = useMemo(
    () => filterEvalItems(items, itemState, { series: seriesFilter, unlabeledOnly }),
    [items, itemState, seriesFilter, unlabeledOnly]
  );
  const counts = useMemo(() => computeEvalCounts(items, itemState), [items, itemState]);
  const readiness = useMemo(() => evaluateCreateReadiness(items, itemState), [items, itemState]);

  const currentItem = useMemo(() => items.find((row) => row.key === currentKey) || null, [items, currentKey]);
  const currentState = (currentItem && itemState[currentItem.key]) || {};
  const currentRotation = nextRotation(currentState.rotation, 0);

  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 8,
  });

  function patchItemState(key, patch) {
    setItemState((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  function rotateCurrent(delta) {
    if (!currentItem) return;
    patchItemState(currentItem.key, { rotation: nextRotation(currentState.rotation, delta) });
  }

  // 保存して次へ: 表示中一覧を基準に次画像へ（未入力のみフィルタ時も1件ずつ。既存ロジックを共通利用）
  function saveAndNext() {
    if (!currentItem) return;
    const allKeys = items.map((row) => row.key);
    const visibleKeys = visibleItems.map((row) => row.key);
    const nextIndex = decideNextImageIndex(allKeys, visibleKeys, currentItem.key);
    setOk(`保存しました: ${currentItem.filename}`);
    if (nextIndex !== null) {
      setCurrentKey(allKeys[nextIndex]);
      labelInputRef.current?.focus();
    }
  }

  async function createDataset() {
    const targets = items.filter((row) => (itemState[row.key] || {}).checked !== false);
    if (targets.length === 0) {
      setFail("評価対象画像がありません");
      return;
    }
    if (readiness.unlabeled > 0) {
      setFail(`未入力の正解ラベルが${readiness.unlabeled}件あります。`);
      return;
    }
    if (readiness.missing > 0) {
      setFail(`出力フォルダの画像が${readiness.missing}件見つかりません。評価対象から外してください。`);
      return;
    }
    setCreating(true);
    try {
      const payload = {
        project_id: projectId,
        dataset_name: datasetName,
        items: targets.map((row) => ({
          export_id: row.exportId,
          filename: row.filename,
          label: String((itemState[row.key] || {}).label || ""),
          rotation: nextRotation((itemState[row.key] || {}).rotation, 0),
          series: row.series,
          source_image: row.sourceImage,
          bbox_id: row.bboxId,
        })),
        editing_state: { items: itemState, currentKey, seriesFilter, unlabeledOnly, datasetName },
      };
      const data = await request("/image-builder/evaluation/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setCreatedResult(data);
      setOk(`評価用データを${data.image_count}件作成しました: ${data.dataset_id}`);
    } catch (e) {
      setFail(`評価データセット作成に失敗しました: ${e.message}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-238px)] min-h-[560px] flex-col gap-2">
      {/* Stepナビ（既存と同形式） */}
      <div className="grid shrink-0 grid-cols-5 gap-2 rounded-xl border border-border bg-card/45 p-2">
        {stepProgress.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepChange(step.id)}
            className={`rounded-lg border px-2 py-1 text-center text-xs font-semibold ${
              step.id === 5
                ? "border-accent bg-accent/20 text-blue-100"
                : step.done
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-border bg-card/60 text-muted hover:text-text"
            }`}
          >
            <div>Step {step.id}</div>
            <div>{step.label}</div>
          </button>
        ))}
      </div>

      {/* 上段: 左=プレビュー / 右=画像情報・回転・ラベル入力 */}
      <div className="flex min-h-0 flex-[0_0_42%] gap-2">
        <Card title="選択画像" subtitle={currentItem ? currentItem.filename : "画像未選択"} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/55 p-2">
            {currentItem ? (
              currentItem.exists === false ? (
                <p className="text-sm text-danger">画像ファイルが見つかりません（出力フォルダを確認してください）</p>
              ) : (
                <img
                  src={cropImageUrl(projectId, currentItem, currentRotation)}
                  alt={currentItem.filename}
                  className="max-h-full max-w-full rounded object-contain"
                />
              )
            ) : (
              <p className="text-sm text-muted">
                {loading ? "評価候補を読み込み中..." : "Step4でクロップ出力すると評価候補が表示されます"}
              </p>
            )}
          </div>
        </Card>

        <div className="flex w-[340px] shrink-0 flex-col gap-2 rounded-xl border border-border bg-card/45 p-3 text-xs">
          <p className="text-[11px] font-semibold text-muted">評価画像情報</p>
          {currentItem ? (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted">ファイル名</span>
                <span className="min-w-0 truncate font-mono text-text" title={`${currentItem.exportId}/${currentItem.filename}`}>
                  {currentItem.filename}
                </span>
                <span className="text-muted">Series</span>
                <span className="text-text">{currentItem.series || "-"}</span>
                <span className="text-muted">元画像</span>
                <span className="min-w-0 truncate text-text" title={currentItem.sourceImage}>
                  {currentItem.sourceImage || "-"}
                </span>
                <span className="text-muted">回転</span>
                <span className="tabular-nums text-text">{currentRotation}°</span>
              </div>
              {/* 回転は評価用コピーへのみ反映（Step4の学習画像は変更しない） */}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => rotateCurrent(90)} disabled={currentItem.exists === false}>
                  ↻ 90°
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => rotateCurrent(180)} disabled={currentItem.exists === false}>
                  ↺ 180°
                </Button>
              </div>
              <div>
                <label className="app-label">正解ラベル（case-sensitive）</label>
                <input
                  ref={labelInputRef}
                  className="app-input font-mono"
                  value={String(currentState.label || "")}
                  onChange={(e) => patchItemState(currentItem.key, { label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveAndNext();
                    }
                  }}
                  placeholder="例: AB12klt"
                />
                <p className="mt-1 text-[11px] text-muted">大文字・小文字はそのまま保存されます（Enter=保存して次へ）</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setOk(`保存しました: ${currentItem.filename}`)}>
                  保存
                </Button>
                <Button size="sm" className="flex-1" onClick={saveAndNext}>
                  保存して次へ
                </Button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  checked={currentState.checked !== false}
                  onChange={() => patchItemState(currentItem.key, { checked: currentState.checked === false })}
                />
                この画像を評価対象にする
              </label>
            </>
          ) : (
            <p className="text-muted">一覧から画像を選択してください</p>
          )}
          <div className="mt-auto flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => onStepChange(4)}>
              Step4へ戻る
            </Button>
          </div>
        </div>
      </div>

      {/* 一覧フィルタ行 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
        <label className="text-muted">Series</label>
        <select className="app-select h-7 w-44 py-0 text-xs" value={seriesFilter} onChange={(e) => setSeriesFilter(e.target.value)}>
          <option value={EVAL_SERIES_ALL}>All ({items.length})</option>
          {seriesOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant={unlabeledOnly ? "primary" : "secondary"}
          className="h-7 px-2 text-[11px]"
          onClick={() => setUnlabeledOnly((prev) => !prev)}
        >
          未入力のみ表示
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-[11px]"
          onClick={() =>
            setItemState((prev) => {
              const next = { ...prev };
              visibleItems.forEach((row) => {
                next[row.key] = { ...(next[row.key] || {}), checked: true };
              });
              return next;
            })
          }
          disabled={visibleItems.length === 0}
        >
          すべて選択
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-[11px]"
          onClick={() =>
            setItemState((prev) => {
              const next = { ...prev };
              visibleItems.forEach((row) => {
                next[row.key] = { ...(next[row.key] || {}), checked: false };
              });
              return next;
            })
          }
          disabled={visibleItems.length === 0}
        >
          すべて解除
        </Button>
        <span className="ml-auto text-muted">
          表示 {visibleItems.length} / {items.length}
        </span>
      </div>

      {/* 一覧（仮想スクロール: 1000件でもDOMは表示分のみ） */}
      <div ref={scrollRef} className="dark-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card/40 p-2">
        {visibleItems.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted">
            {loading ? "読み込み中..." : items.length === 0 ? "評価候補がありません（Step4でクロップ出力してください）" : "フィルタ条件に一致する画像がありません"}
          </p>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleItems[virtualRow.index];
              return (
                <div
                  key={item.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="py-0.5"
                >
                  <EvalListRow
                    projectId={projectId}
                    item={item}
                    state={itemState[item.key] || {}}
                    isCurrent={item.key === currentKey}
                    onSelect={setCurrentKey}
                    onToggleChecked={(key) =>
                      setItemState((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), checked: (prev[key] || {}).checked === false },
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 下部: ステータス + データセット作成 */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs tabular-nums">
        <span>
          評価対象 <span className="font-semibold text-text">{counts.target}</span>
        </span>
        <span>
          登録済み <span className="font-semibold text-emerald-300">{counts.labeled}</span>
        </span>
        <span>
          未入力 <span className={`font-semibold ${counts.unlabeled > 0 ? "text-amber-300" : "text-text"}`}>{counts.unlabeled}</span>
        </span>
        <span>
          回転済み <span className="font-semibold text-text">{counts.rotated}</span>
        </span>
        {readiness.missing > 0 ? (
          <span className="text-danger">画像なし {readiness.missing}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <label className="text-muted">データセット名</label>
          <input
            className="app-input h-7 w-56 py-0 font-mono text-xs"
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            placeholder="未入力は日時で自動命名"
          />
          <Button
            size="sm"
            onClick={createDataset}
            disabled={!readiness.ok || creating}
            title={
              readiness.unlabeled > 0
                ? `未入力の正解ラベルが${readiness.unlabeled}件あります。`
                : readiness.missing > 0
                  ? "出力フォルダに見つからない画像があります"
                  : undefined
            }
          >
            {creating ? "作成中..." : "正解CSVを作成"}
          </Button>
        </span>
      </div>
      {counts.unlabeled > 0 ? (
        <p className="shrink-0 text-xs text-amber-100">
          未入力の正解ラベルが{counts.unlabeled}件あります。
          <button type="button" className="ml-2 underline" onClick={() => setUnlabeledOnly(true)}>
            未入力のみ表示
          </button>
        </p>
      ) : null}
      {createdResult ? (
        <p className="shrink-0 truncate text-xs text-emerald-200" title={createdResult.dataset_dir}>
          作成完了: {createdResult.dataset_id}（{createdResult.image_count}件） → {createdResult.dataset_dir}
        </p>
      ) : null}
      {(message || error) && (
        <div
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${
            error ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"
          }`}
        >
          {error || message}
        </div>
      )}
    </div>
  );
}
