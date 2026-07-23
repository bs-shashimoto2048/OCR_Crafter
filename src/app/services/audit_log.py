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


class UserContext:
    """リクエストのユーザー識別（operator名・ロール・認証設定有無）。"""

    def __init__(self, operator: str = "", role: str = "", auth_configured: bool = False) -> None:
        self.operator = operator or ""
        # 認証未設定モード: ロール未指定はAdmin互換（既存運用を壊さない）。UIへ明示する
        self.role = role if role in ROLES else "admin"
        self.role_explicit = role in ROLES
        self.auth_configured = auth_configured

    def to_dict(self) -> dict[str, Any]:
        return {
            "operator": self.operator,
            "role": self.role,
            "auth_configured": self.auth_configured,
            "auth_mode": "configured" if self.auth_configured else "認証未設定モード（Admin互換）",
        }


def resolve_user_context(headers: Any) -> UserContext:
    """X-Operator / X-Role ヘッダからUserContextを解決する（将来SSO時はここのみ差し替え）。"""
    try:
        operator = str(headers.get("x-operator") or "").strip()
        role = str(headers.get("x-role") or "").strip().lower()
    except Exception:  # noqa: BLE001
        operator, role = "", ""
    return UserContext(operator=operator, role=role, auth_configured=False)


def require_role(ctx: UserContext, action: str) -> None:
    """操作に必要な最低ロールを検証する（不足時PermissionError→403）。

    認証未設定モード（ロール未指定）はAdmin互換のため常に許可。
    X-Roleを明示した場合のみロール階層を強制する。
    """
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
    operator = user.operator if isinstance(user, UserContext) else str(user or "")
    role = user.role if isinstance(user, UserContext) else ""
    with _LOCK:
        counter_path = _audit_root() / "counter.json"
        try:
            counter = int(json.loads(counter_path.read_text(encoding="utf-8")).get("counter") or 0)
        except (OSError, ValueError):
            counter = 0
        counter += 1
        counter_path.write_text(json.dumps({"counter": counter}), encoding="utf-8")
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
