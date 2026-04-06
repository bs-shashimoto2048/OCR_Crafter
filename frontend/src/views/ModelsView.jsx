import Card from "../components/Card";
import Button from "../components/Button";

function basename(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export default function ModelsView({ models, latest, onRefresh }) {
  const latestSquare = basename(latest.square);
  const latestWide = basename(latest.wide);

  return (
    <Card
      title="Model Registry"
      subtitle="最新モデルを優先表示"
      actions={
        <Button variant="secondary" onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border bg-[#333d49] p-3">
          <p className="text-muted">Latest square</p>
          <p className="mt-1 truncate text-text">{latestSquare || "-"}</p>
        </div>
        <div className="rounded-lg border border-border bg-[#333d49] p-3">
          <p className="text-muted">Latest wide</p>
          <p className="mt-1 truncate text-text">{latestWide || "-"}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="px-2 py-3 font-medium">Model File</th>
            <th className="px-2 py-3 font-medium">Type</th>
            <th className="px-2 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {models.map((name) => {
            const isLatest = name === latestSquare || name === latestWide;
            return (
              <tr key={name} className="border-b border-border/80 transition hover:bg-[#3f4b59]">
                <td className="px-2 py-3 text-text">{name}</td>
                <td className="px-2 py-3 text-muted">{name.startsWith("wide_") ? "wide" : "square"}</td>
                <td className="px-2 py-3">
                  {isLatest ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs text-success">
                      Latest
                    </span>
                  ) : (
                    <span className="text-muted">Archive</span>
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
