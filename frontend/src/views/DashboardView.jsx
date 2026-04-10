import Card from "../components/Card";
import Button from "../components/Button";

export default function DashboardView({
  projectId,
  projects,
  newProjectId,
  onNewProjectIdChange,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  imagesCount,
  labeledCount,
  modelCount,
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card hover title="総画像数">
          <p className="text-3xl font-semibold text-text">{imagesCount}</p>
        </Card>
        <Card hover title="ラベル済み">
          <p className="text-3xl font-semibold text-text">{labeledCount}</p>
        </Card>
        <Card hover title="モデル数">
          <p className="text-3xl font-semibold text-text">{modelCount}</p>
        </Card>
      </div>

      <Card title="プロジェクト管理" subtitle="ダッシュボードでプロジェクトを選択・作成・削除します">
        <div className="mb-4 flex items-center gap-3">
          <input
            value={newProjectId}
            onChange={(event) => onNewProjectIdChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCreateProject();
              }
            }}
            className="app-input max-w-xs"
            placeholder="新規プロジェクト名"
          />
          <Button variant="secondary" onClick={onCreateProject}>
            作成
          </Button>
        </div>

        {projects.length === 0 ? (
          <p className="text-sm text-muted">プロジェクトがありません。上の入力欄から作成してください。</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {projects.map((pid) => {
              const selected = pid === projectId;
              return (
                <div
                  key={pid}
                  className={`rounded-xl border p-4 transition ${
                    selected
                      ? "border-accent bg-accent/10 shadow-card"
                      : "border-border bg-[#3b444e]/70 hover:border-accent/50"
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectProject(pid)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectProject(pid);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-text">{pid}</p>
                    {selected ? (
                      <span className="rounded-md border border-accent/50 bg-accent/20 px-2 py-0.5 text-xs text-accent">
                        選択中
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant={selected ? "primary" : "secondary"} onClick={() => onSelectProject(pid)}>
                      {selected ? "使用中" : "選択"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(pid);
                      }}
                    >
                      削除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
