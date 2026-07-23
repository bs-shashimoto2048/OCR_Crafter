"""ドキュメントの相対リンク検証。

docs/*.md・readme.md・CHANGELOG.md 内のMarkdownリンク（[text](path)・![alt](path)）の
リンク先ファイルが実在することを確認する（http/https/mailto/アンカーのみのリンクは対象外）。
ファイル名変更（usage.md→USER_GUIDE.md 等）時のリンク切れを検出する。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Markdownリンク: ![alt](path) / [text](path)。()内の空白・タイトル表記は対象外の簡易版
_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)\)")

# 旧ファイル名（リネーム済み）。新規参照が復活したら失敗させる
_STALE_TARGETS = {
    "usage.md",
    "14_RELEASE_CHECKLIST.md",
    "23_UAT_CHECKLIST.md",
    "27_RELEASE_CHECKLIST.md",
}


def _iter_markdown_files():
    yield REPO_ROOT / "readme.md"
    yield REPO_ROOT / "CHANGELOG.md"
    yield from sorted((REPO_ROOT / "docs").glob("*.md"))


def _iter_links(md_path: Path):
    text = md_path.read_text(encoding="utf-8")
    for match in _LINK_RE.finditer(text):
        target = match.group(1).strip()
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        yield target


def test_docs_relative_links_exist():
    """相対リンクのリンク先ファイルが存在する（アンカーは除去して判定）。"""
    broken: list[str] = []
    for md_path in _iter_markdown_files():
        if not md_path.exists():
            continue
        for target in _iter_links(md_path):
            file_part = target.split("#", 1)[0]
            if not file_part:
                continue
            resolved = (md_path.parent / file_part).resolve()
            if not resolved.exists():
                broken.append(f"{md_path.relative_to(REPO_ROOT)} -> {target}")
    assert not broken, "リンク切れ:\n" + "\n".join(broken)


def test_docs_no_links_to_renamed_files():
    """リネーム済みの旧ファイル名へのMarkdownリンクが存在しない。"""
    stale: list[str] = []
    for md_path in _iter_markdown_files():
        if not md_path.exists():
            continue
        for target in _iter_links(md_path):
            name = target.split("#", 1)[0].rsplit("/", 1)[-1]
            if name in _STALE_TARGETS:
                stale.append(f"{md_path.relative_to(REPO_ROOT)} -> {target}")
    assert not stale, "旧ファイル名への参照:\n" + "\n".join(stale)


def test_docs_image_links_exist():
    """docs内の画像リンク（docs/images/）の実体が存在する。"""
    missing: list[str] = []
    for md_path in _iter_markdown_files():
        if not md_path.exists():
            continue
        text = md_path.read_text(encoding="utf-8")
        for match in re.finditer(r"!\[[^\]]*\]\(([^)\s]+)\)", text):
            target = match.group(1).strip()
            if target.startswith(("http://", "https://")):
                continue
            resolved = (md_path.parent / target).resolve()
            if not resolved.exists():
                missing.append(f"{md_path.relative_to(REPO_ROOT)} -> {target}")
    assert not missing, "画像リンク切れ:\n" + "\n".join(missing)
