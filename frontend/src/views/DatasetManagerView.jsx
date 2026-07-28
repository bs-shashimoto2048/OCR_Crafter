import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { request } from "../lib/api";
import { matchesDatasetSearch, sortDatasetItems } from "../lib/datasetSearch";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ja-JP", { hour12: false });
}

const COLUMNS = [
  { key: "name", label: "Dataset", sortable: true },
  { key: "created_at", label: "作成日時", sortable: true },
  { key: "input_count", label: "画像数", sortable: true },
  { key: "train", label: "Train", sortable: false },
  { key: "val", label: "Val", sortable: false },
  { key: "test", label: "Test", sortable: false },
  { key: "preprocess", label: "前処理", sortable: false },
  { key: "model_count", label: "使用モデル数", sortable: true },
];

function SortIndicator({ active, dir }) {
  if (!active) return null;
  return <span className="ml-1 text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>;
}

export default function DatasetManagerView({ projectId, onOpenModel, onOpenExperiment, detailRequest = null, notify = () => {} }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await request(`/api/ocr/datasets?project_id=${encodeURIComponent(projectId)}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      setItems([]);
      notify("error", `Dataset一覧の取得に失敗しました: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setSelectedId("");
    setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function openDetail(datasetId) {
    setSelectedId(datasetId);
    setDetailLoading(true);
    try {
      const data = await request(`/api/ocr/datasets/${encodeURIComponent(datasetId)}?project_id=${encodeURIComponent(projectId)}`);
      setDetail(data);
      setCommentDraft(data?.comment || "");
    } catch (error) {
      setDetail(null);
      notify("error", `Dataset詳細の取得に失敗しました: ${error.message}`);
    } finally {
      setDetailLoading(false);
    }
  }

  // Model詳細画面からの「使用Dataset」リンク（{id, seq}。seq変化で詳細を開く）
  useEffect(() => {
    if (detailRequest?.id) {
      openDetail(detailRequest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRequest?.seq]);

  const filteredSorted = useMemo(() => {
    const filtered = items.filter((item) =>
      matchesDatasetSearch(search, {
        name: item.name,
        comment: item.comment,
        charset: item.charset,
        preprocessVersion: item.preprocess_config_version,
      })
    );
    return sortDatasetItems(filtered, sortKey, sortDir);
  }, [items, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "created_at" ? "desc" : "asc");
    }
  }

  async function saveComment() {
    if (!selectedId) return;
    setSavingComment(true);
    try {
      const data = await request(`/api/ocr/datasets/${encodeURIComponent(selectedId)}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, comment: commentDraft }),
      });
      setDetail(data);
      await load();
      notify("success", "コメントを保存しました");
    } catch (error) {
      notify("error", `コメント保存に失敗しました: ${error.message}`);
    } finally {
      setSavingComment(false);
    }
  }

  async function copySelected() {
    if (!selectedId) return;
    setCopying(true);
    try {
      const copied = await request(`/api/ocr/datasets/${encodeURIComponent(selectedId)}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      await load();
      notify("success", `コピーを作成しました: ${copied?.name || ""}`);
      if (copied?.dataset_id) {
        await openDetail(copied.dataset_id);
      }
    } catch (error) {
      notify("error", `コピーに失敗しました: ${error.message}`);
    } finally {
      setCopying(false);
    }
  }

  async function deleteSelected() {
    if (!selectedId) return;
    setDeleting(true);
    try {
      const impact = await request(
        `/api/ocr/datasets/${encodeURIComponent(selectedId)}/delete-impact?project_id=${encodeURIComponent(projectId)}`
      );
      const modelNames = Array.isArray(impact?.model_names) ? impact.model_names : [];
      const message =
        modelNames.length > 0
          ? `このDatasetから作成されたモデルが存在します。\n\n${modelNames.join("\n")}\n\n削除すると再現性情報が失われます。\n削除しますか？`
          : "このDatasetを削除します。この操作は取り消せません。削除しますか？";
      const ok = window.confirm(message);
      if (!ok) return;
      await request(`/api/ocr/datasets/${encodeURIComponent(selectedId)}?project_id=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      notify("success", "Datasetを削除しました");
      setSelectedId("");
      setDetail(null);
      await load();
    } catch (error) {
      notify("error", `削除に失敗しました: ${error.message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title={`Dataset Manager（${filteredSorted.length}件）`}
        subtitle="学習データセットの資産管理。作成設定・使用モデル・再現性情報を一元管理します"
        actions={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        <div className="mb-2">
          <input
            className="app-input h-8 w-full max-w-sm text-xs"
            placeholder="Dataset名・コメント・Charset・前処理Versionで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={`max-h-[50vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`whitespace-nowrap px-2 py-1.5 font-medium ${col.sortable ? "cursor-pointer select-none hover:text-text" : ""}`}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.label}
                    {col.sortable ? <SortIndicator active={sortKey === col.key} dir={sortDir} /> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((item) => (
                <tr
                  key={item.dataset_id}
                  tabIndex={0}
                  aria-label={`${item.name} の詳細を表示`}
                  onClick={() => openDetail(item.dataset_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDetail(item.dataset_id);
                    }
                  }}
                  className={`cursor-pointer border-t border-border/60 hover:bg-card/60 focus-visible:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${selectedId === item.dataset_id ? "bg-accent/10" : ""}`}
                >
                  <td className="min-w-0 max-w-[16rem] truncate px-2 py-1.5 text-text" title={item.name}>
                    <span className="model-id-font model-id-text--sm mr-1.5 text-blue-200">{item.dataset_id}</span>
                    {item.name}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{formatDateTime(item.created_at)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.input_count}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.counts?.train ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.counts?.val ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.counts?.test ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                    {item.preprocess_config_version ? `v${item.preprocess_config_version}` : "未記録"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">{item.model_count}</td>
                </tr>
              ))}
              {filteredSorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <EmptyState
                      title={items.length === 0 ? "Datasetがありません" : "条件に一致するDatasetがありません"}
                      description={
                        items.length === 0
                          ? "「データ作成・学習」でOCRデータセットを作成すると、ここへ表示されます。"
                          : "検索条件を見直してください。"
                      }
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedId ? (
        <Card
          title={detail ? `Dataset詳細: ${detail.name}` : "Dataset詳細"}
          subtitle={detail ? `Dataset ID: ${detail.dataset_id}` : undefined}
          actions={
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={copySelected} disabled={copying || detailLoading}>
                {copying ? "コピー中..." : "コピー"}
              </Button>
              <Button size="sm" variant="danger" onClick={deleteSelected} disabled={deleting || detailLoading}>
                {deleting ? "削除中..." : "削除"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedId(""); setDetail(null); }}>
                閉じる
              </Button>
            </div>
          }
        >
          {detailLoading ? (
            <p className="text-sm text-muted">読み込み中...</p>
          ) : detail ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">基本情報</p>
                <p className="text-text">Dataset名: {detail.name}</p>
                <p className="text-muted">Dataset ID: {detail.dataset_id}</p>
                <p className="text-muted">作成日時: {formatDateTime(detail.created_at)}</p>
                {detail.copied_from_dataset_folder ? (
                  <p className="text-muted">コピー元: {detail.copied_from_dataset_folder}</p>
                ) : null}
                {/* v1.0.0で追加（Benchmark Center） */}
                <p className="text-muted">Benchmark: {detail.benchmark_center_count ?? 0}件</p>
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">使用した前処理</p>
                <p className="text-text">Version: {detail.preprocess?.version ? `v${detail.preprocess.version}` : "未記録"}</p>
                <p className="text-muted">保存日時: {formatDateTime(detail.preprocess?.saved_at)}</p>
                <p className="text-muted break-all">Hash: {detail.preprocess?.hash || "未記録"}</p>
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">学習設定</p>
                <p className="text-muted">
                  Train率: {detail.training_settings?.train_ratio ?? "-"} / Validation率: {detail.training_settings?.val_ratio ?? "-"} / Test率: {detail.training_settings?.test_ratio ?? "-"}
                </p>
                <p className="text-muted">Charset: {detail.training_settings?.charset || "-"}</p>
                <p className="text-muted">
                  Rotation: {detail.training_settings?.rotation?.enabled
                    ? `有効（最大${detail.training_settings.rotation.max_degrees ?? "-"}度）`
                    : "無効"}
                </p>
                <p className="text-muted">
                  入力画像数: {detail.training_settings?.input_count ?? 0} / 除外画像数: {detail.training_settings?.excluded_count ?? 0}
                </p>
                <p className="text-muted">
                  Train/Val/Test: {detail.counts?.train ?? 0} / {detail.counts?.val ?? 0} / {detail.counts?.test ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">使用モデル（{detail.models?.length || 0}件）</p>
                {detail.models && detail.models.length > 0 ? (
                  <ul className="space-y-1">
                    {detail.models.map((m) => (
                      <li key={m.name}>
                        <button
                          type="button"
                          className="text-blue-300 hover:underline"
                          onClick={() => onOpenModel?.(m.name)}
                        >
                          {m.model_id ? `${m.model_id} ` : ""}
                          {m.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">このDatasetを使用したモデルはまだありません</p>
                )}
              </div>
              {/* v1.0.0で追加（Experiment Manager強化・10.Dataset側）: 使用Experiment一覧
                  （既存のExperiment Trackingとのリンク。クリックで実験管理へ遷移） */}
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">使用Experiment（{detail.experiments?.length || 0}件）</p>
                {detail.experiments && detail.experiments.length > 0 ? (
                  <ul className="space-y-1">
                    {detail.experiments.map((exp) => (
                      <li key={exp.experiment_id}>
                        <button
                          type="button"
                          className="model-id-font text-blue-300 hover:underline"
                          onClick={() => onOpenExperiment?.(exp.experiment_id)}
                          title="実験管理でこのExperimentを開く"
                        >
                          {exp.experiment_id}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">このDatasetを使用したExperimentはまだありません</p>
                )}
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px] xl:col-span-2">
                <p className="mb-1 font-semibold text-muted">コメント（複数行対応）</p>
                <textarea
                  className="app-input min-h-[80px] w-full text-xs"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="例: CLAHE追加版\nノイズ画像追加\n文字数500→700へ増加"
                />
                <div className="mt-1.5">
                  <Button size="sm" variant="secondary" onClick={saveComment} disabled={savingComment}>
                    {savingComment ? "保存中..." : "コメントを保存"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Datasetが見つかりません</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
