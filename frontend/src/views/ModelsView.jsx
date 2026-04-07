import Card from "../components/Card";
import Button from "../components/Button";

function basename(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export default function ModelsView({ models, latest, onRefresh }) {
  const latestAny = basename(latest.any || "");
  const latestByType = latest.byType || {};
  const latestNames = new Set(Object.values(latestByType).map((path) => basename(path)).filter(Boolean));
  if (latestAny) {
    latestNames.add(latestAny);
  }

  function modelTypeFromName(name) {
    const stem = name.replace(/\.pt$/i, "");
    const idx = stem.indexOf("_");
    if (idx <= 0) return "不明";
    return stem.slice(0, idx);
  }

  return (
    <Card
      title="モデル一覧"
      subtitle="最新モデルを優先表示"
      actions={
        <Button variant="secondary" onClick={onRefresh}>
          更新
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-border bg-[#333d49] p-3">
          <p className="text-muted">最新（全体）</p>
          <p className="mt-1 truncate text-text">{latestAny || "-"}</p>
        </div>
        {Object.entries(latestByType).map(([type, value]) => (
          <div key={type} className="rounded-lg border border-border bg-[#333d49] p-3">
            <p className="text-muted">最新 {type}</p>
            <p className="mt-1 truncate text-text">{basename(value) || "-"}</p>
          </div>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="px-2 py-3 font-medium">モデルファイル</th>
            <th className="px-2 py-3 font-medium">種別</th>
            <th className="px-2 py-3 font-medium">状態</th>
          </tr>
        </thead>
        <tbody>
          {models.map((name) => {
            const isLatest = latestNames.has(name);
            return (
              <tr key={name} className="border-b border-border/80 transition hover:bg-[#3f4b59]">
                <td className="px-2 py-3 text-text">{name}</td>
                <td className="px-2 py-3 text-muted">{modelTypeFromName(name)}</td>
                <td className="px-2 py-3">
                  {isLatest ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs text-success">
                      最新
                    </span>
                  ) : (
                    <span className="text-muted">過去モデル</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
