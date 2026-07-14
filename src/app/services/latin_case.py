"""EasyOCR / PaddleOCR の「小文字を出力に含める」制御の共通処理。

- EasyOCR: readtext(allowlist=...) が使えるため、可能な限りエンジン側で候補を制限する
- PaddleOCR: 3.x 系の推論APIには実行時whitelistがないため、出力後に英字を大文字へ正規化する
  （小文字を削除せず大文字へ変換し、文字列長と情報を維持する）

日本語・中国語・韓国語など大小文字の区別が意味を持たない言語設定では適用しない。
Tesseract は既存の charset / whitelist 仕様を維持するため対象外。
"""

from typing import Optional

LOWERCASE_LATIN = "abcdefghijklmnopqrstuvwxyz"
UPPERCASE_LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"

# 小文字OFF時の基本許可文字（既存許可文字がある場合はそちらから小文字のみ除外する）
BASE_UPPERCASE_ALLOWLIST = UPPERCASE_LATIN + DIGITS

# ラテン文字を主体とし、大小文字の区別が意味を持つ言語コード。
# EasyOCR（en, fr, de, es, it, pt, ...）と PaddleOCR（en, latin, french, german, ...）の両方の表記を含む。
LATIN_CASE_LANGS = frozenset(
    {
        # EasyOCR / PaddleOCR 共通
        "en", "fr", "de", "es", "it", "pt", "nl",
        # PaddleOCR 系の表記
        "latin", "french", "german",
        # その他のラテン文字言語（EasyOCR対応コード）
        "af", "az", "bs", "cs", "cy", "da", "et", "fi", "ga", "hr", "hu",
        "id", "is", "lt", "lv", "ms", "mt", "no", "oc", "pl", "ro", "sk",
        "sl", "sq", "sv", "sw", "tl", "tr", "uz", "vi",
    }
)

_LOWERCASE_SET = frozenset(LOWERCASE_LATIN)


def is_latin_case_langs(languages: Optional[list[str]]) -> bool:
    """選択言語すべてがラテン文字言語のときのみ True。

    日本語などの非ラテン言語が1つでも含まれる場合は、
    英数字だけの allowlist や大文字化を適用してはならないため False を返す。
    """
    langs = [str(lang or "").strip().lower() for lang in (languages or [])]
    langs = [lang for lang in langs if lang]
    if not langs:
        return False
    return all(lang in LATIN_CASE_LANGS for lang in langs)


def build_latin_allowlist(
    *,
    include_lowercase: bool,
    base_allowlist: Optional[str] = None,
) -> Optional[str]:
    """エンジンへ渡す許可文字を組み立てる。None は「制限しない」を意味する。

    - base_allowlist なし + 小文字ON  → None（既存動作を変えない）
    - base_allowlist なし + 小文字OFF → A-Z0-9
    - base_allowlist あり + 小文字ON  → 既存許可文字 + 不足している a-z を追加
    - base_allowlist あり + 小文字OFF → 既存許可文字から a-z のみ除外（記号等は維持）
    """
    if base_allowlist is None:
        return None if include_lowercase else BASE_UPPERCASE_ALLOWLIST
    base = "".join(dict.fromkeys(str(base_allowlist)))
    if include_lowercase:
        missing = "".join(ch for ch in LOWERCASE_LATIN if ch not in base)
        return base + missing
    return "".join(ch for ch in base if ch not in _LOWERCASE_SET)


def normalize_latin_case(text: str, *, include_lowercase: bool) -> str:
    """小文字OFF時は英字を大文字へ統一する（削除はしない）。数字・記号は不変。"""
    value = str(text or "")
    if include_lowercase:
        return value
    return value.upper()
