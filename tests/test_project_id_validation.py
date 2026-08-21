"""Project ID Validation Before Path Use（Issue #158）のテスト。

Issue #156の実装中に発見・修正した`restore_backup()`の`new_project_id`検証タイミング
バグを受け、project/dataset/model/job等のユーザー入力IDがfilesystem pathへ到達する
経路を横断的に監査した。本Issue自体で新たに発見した追加の脆弱性は無かったが
（詳細はworkitem doc参照）、監査の中核となる`normalize_project_id()`に単体テストが
一切無かったことを確認し、本ファイルで新設する。実`data/projects/`へは一切触れない
（`temp_projects`フィクスチャで隔離）。
"""

from pathlib import Path

import pytest

from src.app.project_paths import normalize_project_id


# ---------------------------------------------------------------------------
# normalize_project_id(): 単体テスト（既存helperの直接的なテストが無かったため新設）
# ---------------------------------------------------------------------------


class TestNormalizeProjectId:
    def test_valid_id_returned_unchanged(self):
        assert normalize_project_id("my_project-1") == "my_project-1"

    def test_none_returns_default(self):
        assert normalize_project_id(None) == "default"

    def test_empty_string_returns_default(self):
        assert normalize_project_id("") == "default"

    def test_whitespace_only_returns_default(self):
        assert normalize_project_id("   ") == "default"

    @pytest.mark.parametrize(
        "traversal_id",
        [
            "../escape",
            "..\\escape",
            "../../etc",
            "a/../../escape",
        ],
    )
    def test_path_traversal_rejected(self, traversal_id):
        with pytest.raises(ValueError):
            normalize_project_id(traversal_id)

    def test_dot_dot_alone_rejected(self):
        with pytest.raises(ValueError, match="path traversal"):
            normalize_project_id("..")

    def test_single_dot_rejected(self):
        """'.'（現ディレクトリ）はpath traversal規約と同じ扱いで拒否される
        （project_idとしての単独'.'は意味を持たず、Path('.')=CWD化のリスクがあるため）。"""
        with pytest.raises(ValueError):
            normalize_project_id(".")

    @pytest.mark.parametrize("absolute_id", ["C:\\Windows\\System32", "C:/Windows/System32", "/etc/passwd"])
    def test_absolute_or_drive_qualified_path_rejected(self, absolute_id):
        """絶対パス判定はpathlibの実装がWindows/POSIXで異なるため、拒否される
        具体的な分岐（'absolute path'メッセージか、'/'/'\\'禁止メッセージか）は
        プラットフォームによって変わりうる（例: Windows pathlibは'C:\\...'を
        絶対パスと認識するが、POSIX pathlibは認識せず、後続の separator禁止
        チェックで拒否される）。いずれの分岐でも**必ず拒否される**ことのみを
        プラットフォーム非依存で確認する。"""
        with pytest.raises(ValueError):
            normalize_project_id(absolute_id)

    @pytest.mark.parametrize("separator_id", ["a/b", "a\\b", "sub/dir/deep"])
    def test_path_separator_rejected(self, separator_id):
        with pytest.raises(ValueError, match="not allowed"):
            normalize_project_id(separator_id)

    def test_max_length_enforced(self):
        with pytest.raises(ValueError, match="max length"):
            normalize_project_id("a" * 65)

    def test_max_length_boundary_allowed(self):
        assert normalize_project_id("a" * 64) == "a" * 64

    def test_nfkc_normalization_applied(self):
        """全角英数字はNFKC正規化される（既存の意図的な仕様、他のproject_id経路と
        同じ正規化がnew_project_id等どの入力経路でも一貫して適用されることの確認）。"""
        fullwidth = "\uff21\uff22\uff23"  # "ＡＢＣ"（全角）
        assert normalize_project_id(fullwidth) == "ABC"

    def test_idempotent_no_double_normalization_bug(self):
        """既に正規化済みのIDを再度normalize_project_id()へ通しても意味が変わらない
        （Issue #158の"No Double-normalization Bugs"要求）。"""
        once = normalize_project_id("Some_Project-42")
        twice = normalize_project_id(once)
        assert once == twice


# ---------------------------------------------------------------------------
# API層: POST /api/backups/{backup_id}/restore のnew_project_id検証（Issue #156の
# 修正がAPI層まで正しく伝播していることを確認する）
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(temp_projects):
    from fastapi.testclient import TestClient

    import src.app.main as main_module

    return TestClient(main_module.app, raise_server_exceptions=False)


def _create_backup_via_api(client, project_id="default"):
    create_resp = client.post("/api/backups", json={"project_id": project_id, "mode": "metadata_only"})
    assert create_resp.status_code == 200
    return create_resp.json()["item"]["backup_id"]


@pytest.mark.parametrize(
    "malicious_new_project_id",
    ["../../escaped", "..", "/absolute/unix/path", "sub/dir", "sub\\dir"],
)
def test_restore_api_rejects_path_traversal_new_project_id(client, temp_projects, malicious_new_project_id):
    """API層（POST /api/backups/{backup_id}/restore）でも、不正なnew_project_idは
    400として拒否され、projects_dir配下に予期しないエントリを作らない
    （Issue #156の修正が service層だけでなくAPI層まで到達していることの確認）。"""
    backup_id = _create_backup_via_api(client)
    projects_dir = temp_projects["projects_dir"]
    before = sorted(p.name for p in projects_dir.iterdir())

    response = client.post(f"/api/backups/{backup_id}/restore", json={"new_project_id": malicious_new_project_id})

    assert response.status_code == 400
    after = sorted(p.name for p in projects_dir.iterdir())
    assert before == after


def test_restore_api_legitimate_new_project_id_succeeds(client, temp_projects):
    backup_id = _create_backup_via_api(client)
    response = client.post(f"/api/backups/{backup_id}/restore", json={"new_project_id": "restored_via_api"})
    assert response.status_code == 200
    assert response.json()["project_id"] == "restored_via_api"


# ---------------------------------------------------------------------------
# Validate-before-use ordering（新規path構築・書込みより前にvalidationが走ること）
# ---------------------------------------------------------------------------


def test_normalize_project_id_runs_before_any_directory_is_created(monkeypatch, temp_projects):
    """project_id検証は、対象ディレクトリのmkdir等より前に実行される
    （get_project_paths()がPROJECTS_DIR / idを組み立てる前にnormalize_project_id()を
    呼ぶ既存実装を、mkdir呼び出しの監視で直接確認する）。"""
    import src.app.project_paths as project_paths_module

    mkdir_calls: list[Path] = []
    original_mkdir = Path.mkdir

    def _tracking_mkdir(self, *args, **kwargs):
        mkdir_calls.append(self)
        return original_mkdir(self, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", _tracking_mkdir)

    with pytest.raises(ValueError):
        project_paths_module.ensure_project_directories("../escape_attempt")

    # 検証が先に失敗するため、mkdirは一度も呼ばれていない
    assert mkdir_calls == []
