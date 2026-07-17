"""OCR候補プレビューの結果キャッシュ（プロセス内・サイズ制限付きLRU）。

Step5「評価用データ作成」のOCR候補は、同一画像・同一設定で繰り返し実行されやすい
（画像を行き来する・設定を戻す等）。処理済み画像のsha256と推論設定をキーに結果を
再利用し、同一条件の再計算を避ける。

- キーは「処理済み画像sha256 + engine/model/language/小文字/PSM/whitelist」。
  処理済み画像のハッシュは 元画像・回転・Step5専用前処理・プロジェクト共通前処理 の
  すべてを反映するため、いずれかが変わればキーも変わる
- エラー結果はキャッシュしない（呼び出し側で set をスキップする）
- 評価データセットの作成画像・CSVには一切関与しない（OCR候補プレビュー専用）
"""

import json
from collections import OrderedDict
from threading import Lock
from typing import Any, Optional

_MAX_ENTRIES = 128
_cache: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_lock = Lock()


def make_preview_cache_key(processed_sha: str, **fields: Any) -> str:
    """処理済み画像sha256と推論設定からキャッシュキーを作る（フィールド順に依存しない）。"""
    return json.dumps([processed_sha, sorted(fields.items())], ensure_ascii=False)


def get_cached_preview_result(key: str) -> Optional[dict[str, Any]]:
    with _lock:
        if key not in _cache:
            return None
        _cache.move_to_end(key)
        return dict(_cache[key])


def set_cached_preview_result(key: str, result: dict[str, Any]) -> None:
    with _lock:
        _cache[key] = dict(result)
        _cache.move_to_end(key)
        while len(_cache) > _MAX_ENTRIES:
            _cache.popitem(last=False)


def clear_preview_cache() -> None:
    """テスト用: キャッシュを全消去する。"""
    with _lock:
        _cache.clear()
