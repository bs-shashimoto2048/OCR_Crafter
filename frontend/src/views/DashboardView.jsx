import Card from "../components/Card";
import Button from "../components/Button";

export default function DashboardView({
  imagesCount,
  labeledCount,
  modelCount,
  onRefresh,
  onPreprocess,
  onBuildDataset,
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card hover title="Total Images" subtitle="取り込み済み画像">
          <p className="text-3xl font-semibold text-text">{imagesCount}</p>
        </Card>
        <Card hover title="Labeled" subtitle="ラベル入力済み">
          <p className="text-3xl font-semibold text-text">{labeledCount}</p>
        </Card>
        <Card hover title="Models" subtitle="保存済みモデル">
          <p className="text-3xl font-semibold text-text">{modelCount}</p>
        </Card>
      </div>

      <Card title="Pipeline Actions" subtitle="前処理とデータセット生成を実行します">
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onRefresh}>
            Refresh Data
          </Button>
          <Button variant="primary" onClick={onPreprocess}>
            Run Preprocess
          </Button>
          <Button variant="secondary" onClick={onBuildDataset}>
            Build Dataset
          </Button>
        </div>
      </Card>
    </div>
  );
}
