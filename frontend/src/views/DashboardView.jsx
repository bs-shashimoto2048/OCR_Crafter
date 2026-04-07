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
          <Button variant="secondary" onClick={onRefresh}>
            データ更新
          </Button>
          <Button variant="primary" onClick={onPreprocess}>
            前処理を実行
          </Button>
          <Button variant="secondary" onClick={onBuildDataset}>
            データセット作成
          </Button>
        </div>
      </Card>
    </div>
  );
}
