"""画像一覧用サムネイルAPIの回帰テスト（実在=200/JPEG、非実在=404）。"""

from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image

from src.app.main import image_thumbnail
from src.app.project_paths import ensure_project_directories


def test_thumbnail_returns_jpeg_within_bounds(temp_projects):
    paths = ensure_project_directories("thumbtest")
    Image.new("RGB", (200, 48), (255, 0, 0)).save(paths.raw / "01.png")

    response = image_thumbnail("01.png", project_id="thumbtest", width=240, height=96)
    assert response.media_type == "image/jpeg"
    cached = Path(response.path)
    assert cached.exists()
    with Image.open(cached) as thumb:
        assert thumb.format == "JPEG"
        assert thumb.width <= 240 and thumb.height <= 96
        # アスペクト比維持（200x48 -> 等比で高さ96以下に収まる）
        assert abs((thumb.width / thumb.height) - (200 / 48)) < 0.1

    # キャッシュ再利用（同一ファイルを返す）
    response2 = image_thumbnail("01.png", project_id="thumbtest", width=240, height=96)
    assert Path(response2.path) == cached


def test_thumbnail_missing_image_returns_404(temp_projects):
    ensure_project_directories("thumbtest")
    with pytest.raises(HTTPException) as exc:
        image_thumbnail("missing.png", project_id="thumbtest", width=240, height=96)
    assert exc.value.status_code == 404


def test_thumbnail_rejects_path_traversal(temp_projects):
    ensure_project_directories("thumbtest")
    with pytest.raises(HTTPException) as exc:
        image_thumbnail("../secret.png", project_id="thumbtest", width=240, height=96)
    assert exc.value.status_code == 400
