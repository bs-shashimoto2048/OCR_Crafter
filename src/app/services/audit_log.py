"""監査ログ（Audit Log）とユーザー識別（UserContext / 権限）。

- 監査ログは data/audit/audit.jsonl への**追記型JSONL**（アプリのAPIからの削除・編集は
  提供しない=通常UIから削除不可。保持期間による整理はデータ保持設定の運用のみ）
- 保存項目: Audit ID（AUD-000001形式・全体一意）/ Timestamp / User / Action / Project /
  TargetType / TargetID / Before / After / Reason / JobID / Client情報（IP・User-Agent）
- **パスワード・トークン・APIキー・画像バイナリは保存しない**（_sanitize が
  機密キーの除去・バイナリ/巨大値の切り詰めを行う）
- ユーザー識別: X-Operator / X-Role ヘッダ（UserContext）。認証基盤（SSO等）は未導入のため
  未指定は「認証未設定モード」= Admin互換で動作し、その旨をUIへ明示する。
  将来SSO導入時はヘッダの解決部分（resolve_user_context）のみ差し替えればよい
- 権限ロール: viewer < operator < approver < admin（require_role で不足時403相当のPermissionError）
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .. import project_paths as project_paths_module

_LOCK = threading.RLock()

# 監査対象の操作（基本13種＋Phase 5のバックアップ復元・保持期間削除の2種）
AUDIT_ACTIONS = [
    "project_create",
    "project_delete",
    "preprocess_run",
    "dataset_create",
    "training_start",
    "model_delete",
    "release_status_change",
    "release_promote",
    "release_rollback",
    "release_policy_update",
    "benchmark_run",
    "job_cancel",
    "job_retry",
    "backup_restore",
    "retention_cleanup",
    # 監査補完（最終検証フェーズ③）
    "job_finished",  # Job完了（succeeded/failed/cancelled。Service層=Worker実行でも記録）
    "evaluation_run",  # モデル評価の実行
    "experiment_update",  # Experimentタグ・メモ・実験名等の変更
    "analysis_toggle",  # 分析対象ON/OFF
    "backup_create",  # バックアップ作成
    "deployment_export",  # Deployment Package Export
    "restore_failed",  # バックアップ復元の失敗（整合性エラー等）
]

# 権限ロール（弱い順）と操作に必要な最低ロール
ROLES = ["viewer", "operator", "approver", "admin"]
ACTION_MIN_ROLE = {
    "project_create": "operator",
    "project_delete": "admin",
    "preprocess_run": "operator",
    "dataset_create": "operator",
    "training_start": "operator",
    "model_delete": "admin",
    "release_status_change": "operator",
    "release_promote": "approver",
    "release_rollback": "approver",
    "release_policy_update": "admin",
    "benchmark_run": "operator",
    "job_cancel": "operator",
    "job_retry": "operator",
    "backup_restore": "admin",
    "retention_cleanup": "admin",
    "job_finished": "operator",  # システム（Worker）記録用。API経由の強制対象ではない
    "evaluation_run": "operator",
    "experiment_update": "operator",
    "analysis_toggle": "operator",
    "backup_create": "operator",
    "deployment_export": "operator",
    "restore_failed": "admin",
}

# 保存禁止キー（部分一致・小文字比較）: パスワード・トークン・APIキー等の機密情報
_FORBIDDEN_KEY_PARTS = ("password", "passwd", "token", "api_key", "apikey", "secret", "credential", "authorization")
_MAX_VALUE_LENGTH = 2000


def _audit_root() -> Path:
    root = Path(project_paths_module.PROJECTS_DIR).parent / "audit"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sanitize(value: Any, depth: int = 0) -> Any:
    """機密キーの除去・バイナリ拒否・巨大値の切り詰め（画像バイナリ等を保存しない）。"""
    if depth > 6:
        return "[深すぎるため省略]"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "[バイナリは保存しません]"
    if isinstance(value, str):
        return value if len(value) <= _MAX_VALUE_LENGTH else value[:_MAX_VALUE_LENGTH] + "…[切り詰め]"
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            key_text = str(key)
            if any(part in key_text.lower() for part in _FORBIDDEN_KEY_PARTS):
                continue  # 機密キーは値ごと保存しない
            cleaned[key_text] = _sanitize(item, depth + 1)
        return cleaned
    if isinstance(value, (list, tuple)):
        return [_sanitize(item, depth + 1) for item in list(value)[:100]]
    return value


class AuthenticationError(Exception):
    """認証情報の不足（401相当）。本番モード（Admin互換無効）でのみ発生する。"""


def allow_unauthenticated_admin() -> bool:
    """認証未設定モード（Admin互換）の許可判定。

    優先順位: 環境変数 OCRC_ALLOW_UNAUTHENTICATED_ADMIN（"false"/"0"/"no"で無効） →
    settings.yaml の security.allow_unauthenticated_admin → 既定 true（開発・移行用）。
    本番配備では false を指定し、X-Operator必須（401）・不正Role拒否（403）にする。
    """
    import os

    env_value = str(os.environ.get("OCRC_ALLOW_UNAUTHENTICATED_ADMIN") or "").strip().lower()
    if env_value:
        return env_value not in {"false", "0", "no"}
    try:
        from ..config import get_settings

        configured = (get_settings().get("security") or {}).get("allow_unauthenticated_admin")
        if configured is not None:
            return bool(configured)
    except Exception:  # noqa: BLE001
        pass
    return True


class UserContext:
    """リクエストのユーザー識別（operator名・ロール・認証モード）。"""

    def __init__(self, operator: str = "", role: str = "", strict: Optional[bool] = None) -> None:
        self.operator = operator or ""
        self.strict = bool(strict) if strict is not None else not allow_unauthenticated_admin()
        self.raw_role = role
        self.invalid_role = bool(role) and role not in ROLES
        if role in ROLES:
            self.role = role
        elif self.strict:
            # 本番モード: ロール未指定は最小権限（viewer）。Admin互換にしない
            self.role = "viewer"
        else:
            # 認証未設定モード: ロール未指定はAdmin互換（既存運用を壊さない）。UIへ明示する
            self.role = "admin"
        self.role_explicit = role in ROLES

    @property
    def auth_configured(self) -> bool:
        return self.strict

    def to_dict(self) -> dict[str, Any]:
        return {
            "operator": self.operator,
            "role": self.role,
            "auth_configured": self.strict,
            "strict": self.strict,
            "auth_mode": (
                "本番認証モード（Admin互換無効・X-Operator必須）" if self.strict else "認証未設定モード（Admin互換）"
            ),
        }


def resolve_user_context(headers: Any) -> UserContext:
    """X-Operator / X-Role ヘッダからUserContextを解決する（将来SSO時はここのみ差し替え）。"""
    try:
        operator = str(headers.get("x-operator") or "").strip()
        role = str(headers.get("x-role") or "").strip().lower()
    except Exception:  # noqa: BLE001
        operator, role = "", ""
    return UserContext(operator=operator, role=role)


def require_role(ctx: UserContext, action: str) -> None:
    """操作に必要な最低ロールを検証する。

    - 本番モード（allow_unauthenticated_admin=false）: X-Operatorなし・空のOperator名は
      AuthenticationError（401）。不正なRole文字列はPermissionError（403）
    - 認証未設定モード: ロール未指定はAdmin互換のため常に許可。
      X-Roleを明示した場合のみロール階層を強制する
    """
    if ctx.strict and not ctx.operator:
        raise AuthenticationError(
            "認証が必要です（X-Operatorヘッダで操作者名を指定してください。空のOperator名は使用できません）"
        )
    if ctx.invalid_role:
        raise PermissionError(f"不正なロールです: {ctx.raw_role}（{ROLES} のいずれかを指定してください）")
    minimum = ACTION_MIN_ROLE.get(action, "operator")
    if ROLES.index(ctx.role) < ROLES.index(minimum):
        raise PermissionError(
            f"この操作（{action}）には {minimum} 以上のロールが必要です（現在: {ctx.role}）"
        )


def record_audit(
    action: str,
    user: UserContext | str = "",
    project_id: str = "",
    target_type: str = "",
    target_id: str = "",
    before: Any = None,
    after: Any = None,
    reason: str = "",
    job_id: str = "",
    client: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """監査エントリを追記する（AUD-000001形式・全体一意）。失敗させない設計は呼び出し側で行う。"""
    if action not in AUDIT_ACTIONS:
        raise ValueError(f"unknown audit action: {action}（{AUDIT_ACTIONS}）")
    from .atomic_io import atomic_write_json, file_lock

    operator = user.operator if isinstance(user, UserContext) else str(user or "")
    role = user.role if isinstance(user, UserContext) else ""
    counter_path = _audit_root() / "counter.json"
    with _LOCK, file_lock(counter_path):
        try:
            counter = int(json.loads(counter_path.read_text(encoding="utf-8")).get("counter") or 0)
        except (OSError, ValueError):
            counter = 0
        counter += 1
        atomic_write_json(counter_path, {"counter": counter})
        entry = {
            "audit_id": f"AUD-{counter:06d}",
            "timestamp": datetime.now().isoformat(),
            "user": operator,
            "role": role,
            "action": action,
            "project_id": str(project_id or ""),
            "target_type": str(target_type or ""),
            "target_id": str(target_id or ""),
            "before": _sanitize(before) if before is not None else None,
            "after": _sanitize(after) if after is not None else None,
            "reason": str(reason or "")[:_MAX_VALUE_LENGTH],
            "job_id": str(job_id or ""),
            "client": _sanitize(client or {}),
        }
        with (_audit_root() / "audit.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry


def read_audit(
    project_id: str = "",
    action: str = "",
    user: str = "",
    target_id: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 200,
) -> list[dict[str, Any]]:
    """監査ログの読み出し（新しい順・フィルタ）。削除・編集APIは提供しない（追記型）。"""
    path = _audit_root() / "audit.jsonl"
    entries: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in reversed(lines):  # 新しい順
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if project_id and entry.get("project_id") != project_id:
            continue
        if action and entry.get("action") != action:
            continue
        if user and user.lower() not in str(entry.get("user") or "").lower():
            continue
        if target_id and target_id.lower() not in str(entry.get("target_id") or "").lower():
            continue
        stamp = str(entry.get("timestamp") or "")[:10]
        if date_from and stamp < date_from:
            continue
        if date_to and stamp > date_to:
            continue
        entries.append(entry)
        if len(entries) >= max(1, int(limit)):
            break
    return entries
