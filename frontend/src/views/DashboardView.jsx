import Card from "../components/Card";
import Button from "../components/Button";

export default function DashboardView({
  imagesCount,
  labeledCount,
  modelCount,
  onRefresh,
  onPreprocess,
  onBuildDataset,
  workflowState,
}) {
  const refreshed = Boolean(workflowState?.refreshed);
  const preprocessed = Boolean(workflowState?.preprocessed);
  const datasetBuilt = Boolean(workflowState?.datasetBuilt);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card hover title="総画像数" subtitle="取り込み済み画像">
          <p className="text-3xl font-semibold text-text">{imagesCount}</p>
        </Card>
        <Card hover title="ラベル済み" subtitle="ラベル入力済み">
          <p className="text-3xl font-semibold text-text">{labeledCount}</p>
        </Card>
        <Card hover title="モデル数" subtitle="保存済みモデル">
          <p className="text-3xl font-semibold text-text">{modelCount}</p>
        </Card>
      </div>

      <Card title="実行メニュー" subtitle="前処理とデータセット生成を実行します">
        <div className="flex gap-3">
          <Button
            variant={refreshed ? "primary" : "secondary"}
            className={refreshed ? "!bg-success hover:!bg-emerald-500 text-white" : ""}
            onClick={onRefresh}
          >
            データ更新
          </Button>
          <Button
            variant={preprocessed ? "primary" : "secondary"}
            className={preprocessed ? "!bg-success hover:!bg-emerald-500 text-white" : ""}
            onClick={onPreprocess}
          >
            前処理を実行
          </Button>
          <Button
            variant={datasetBuilt ? "primary" : "secondary"}
            className={datasetBuilt ? "!bg-success hover:!bg-emerald-500 text-white" : ""}
            onClick={onBuildDataset}
          >
            データセット作成
          </Button>
        </div>
      </Card>
    </div>
  );
}
