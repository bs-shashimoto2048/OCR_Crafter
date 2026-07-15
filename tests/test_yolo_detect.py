"""学習画像作成 Step2（YOLO検出）のモデル解決・一覧・推論の回帰テスト。

不具合の背景: 共通モデル置き場（リポジトリ直下 models/yolo）が一覧・解決の
検索対象外だったため、保存済み選択が汎用ビルトインへ黙って置き換わり
「検出0件＝検出が動作しない」ように見えた。
"""

import io
from pathlib import Path

import pytest
from PIL import Image

import src.app.services.training_image_builder as tib

REPO_ROOT = Path(__file__).resolve().parents[1]
# 実推論用モデル（存在しない環境ではスキップ。ネットワークダウンロードはしない）
BUILTIN_MODEL_FILE = REPO_ROOT / "yolo11n.pt"
REAL_MODEL_FILE = REPO_ROOT / "models" / "yolo" / "TrmRead_yolo26s_20260401.pt"
REAL_IMAGE_FILE = REPO_ROOT / "data" / "projects" / "tube_20260710" / "raw" / "001.png"


def _png_bytes(width=64, height=32, color=(255, 255, 255)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


def _setup_common_dir(tmp_path, monkeypatch, names=()):
    common = tmp_path / "common_yolo"
    common.mkdir(parents=True, exist_ok=True)
    for name in names:
        (common / name).write_bytes(b"dummy")
    monkeypatch.setattr(tib, "COMMON_YOLO_MODELS_DIR", common)
    return common


def test_list_includes_common_models(temp_projects, monkeypatch):
    """共通 models/yolo のモデルが一覧へ含まれ、ユーザーモデルが先頭に来る。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["custom_a.pt"])
    result = tib.list_yolo_models(project_id="p1")
    assert result["common_models"] == ["custom_a.pt"]
    assert result["items"][0] == "custom_a.pt"
    for builtin in result["builtin_models"]:
        assert builtin in result["items"]


def test_list_without_common_dir_keeps_builtins(temp_projects, monkeypatch):
    """共通ディレクトリが無い場合は従来どおりビルトインのみ（後方互換）。"""
    monkeypatch.setattr(tib, "COMMON_YOLO_MODELS_DIR", temp_projects["tmp"] / "not_exist")
    result = tib.list_yolo_models(project_id="p1")
    assert result["common_models"] == []
    assert result["items"] == result["builtin_models"]


def test_list_project_local_dedupes_common(temp_projects, monkeypatch):
    """プロジェクト内と共通で同名モデルがある場合は重複せず1件（プロジェクト内優先）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["dup.pt"])
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "dup.pt").write_bytes(b"dummy")
    result = tib.list_yolo_models(project_id="p1")
    assert result["items"].count("dup.pt") == 1
    assert result["local_models"] == ["dup.pt"]


def test_resolve_prefers_project_local(temp_projects, monkeypatch):
    """同名モデルはプロジェクト内が共通より優先して解決される。"""
    common = _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["dup.pt"])
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "dup.pt").write_bytes(b"dummy")
    resolved = tib._resolve_model_name("dup.pt", "p1")
    assert Path(resolved) == (yolo_dir / "dup.pt").resolve()
    assert Path(resolved) != (common / "dup.pt").resolve()


def test_resolve_common_model(temp_projects, monkeypatch):
    """プロジェクト内に無いモデル名は共通 models/yolo から解決される（今回の修正の本体）。"""
    common = _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["custom_a.pt"])
    resolved = tib._resolve_model_name("custom_a.pt", "p1")
    assert Path(resolved) == (common / "custom_a.pt").resolve()


def test_resolve_unknown_returns_candidate(temp_projects, monkeypatch):
    """どこにも無い名前はそのまま返す（ビルトイン名のultralytics自動解決を維持）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    assert tib._resolve_model_name("yolo11n.pt", "p1") == "yolo11n.pt"


def test_detect_invalid_image_raises_value_error(temp_projects, monkeypatch):
    """不正画像はモデル読込前に明示エラー（ValueError→400）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(ValueError):
        tib.detect_bboxes_with_yolo(
            image_bytes=b"not an image",
            long_side=640,
            use_resize=True,
            resize_axis="long",
            model_name="whatever.pt",
            conf_threshold=0.25,
            merge_overlaps=True,
            merge_iou_threshold=0.5,
            project_id="p1",
        )


@pytest.mark.skipif(not BUILTIN_MODEL_FILE.exists(), reason="yolo11n.pt がリポジトリ直下に無い")
def test_detect_zero_detections_is_normal_response(temp_projects, monkeypatch):
    """真っ白画像は検出0件でも正常レスポンス（例外や空bodyにしない）。前処理OFF。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    result = tib.detect_bboxes_with_yolo(
        image_bytes=_png_bytes(64, 32),
        long_side=640,
        use_resize=True,
        resize_axis="long",
        model_name=str(BUILTIN_MODEL_FILE),
        conf_threshold=0.25,
        merge_overlaps=True,
        merge_iou_threshold=0.5,
        project_id="p1",
    )
    assert result["count"] == 0
    assert result["detections"] == []
    assert result["raw_count"] == 0
    assert result["original_size"] == [64, 32]
    assert isinstance(result["resized_size"], list) and len(result["resized_size"]) == 2


@pytest.mark.skipif(not BUILTIN_MODEL_FILE.exists(), reason="yolo11n.pt がリポジトリ直下に無い")
def test_detect_with_preprocess_rotation(temp_projects, monkeypatch):
    """検出前処理ON（回転90°）でもサイズメタデータが前処理後の座標系で返る。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    result = tib.detect_bboxes_with_yolo(
        image_bytes=_png_bytes(64, 32),
        long_side=640,
        use_resize=True,
        resize_axis="long",
        model_name=str(BUILTIN_MODEL_FILE),
        conf_threshold=0.25,
        merge_overlaps=True,
        merge_iou_threshold=0.5,
        project_id="p1",
        detect_preprocess={"rotation": 90},
    )
    # 64x32 を90°回転 → 32x64（前処理後サイズが original_size として返る）
    assert result["original_size"] == [32, 64]
    assert result["count"] >= 0


@pytest.mark.skipif(
    not (REAL_MODEL_FILE.exists() and REAL_IMAGE_FILE.exists()),
    reason="実モデル/実画像が無い環境ではスキップ（読み取りのみ・書き込みなし）",
)
def test_detect_real_model_finds_boxes_with_expected_format(temp_projects, monkeypatch):
    """実モデル×実画像で検出でき、BBOXがpixel座標のxyxy形式で返る（Step3が期待する形式）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    result = tib.detect_bboxes_with_yolo(
        image_bytes=REAL_IMAGE_FILE.read_bytes(),
        long_side=1280,
        use_resize=True,
        resize_axis="width",
        model_name=str(REAL_MODEL_FILE),
        conf_threshold=0.25,
        merge_overlaps=True,
        merge_iou_threshold=0.5,
        project_id="p1",
    )
    assert result["count"] > 0
    width, height = result["resized_size"]
    row = result["detections"][0]
    expected_keys = {"id", "x1", "y1", "x2", "y2", "width", "height", "confidence", "label", "class_id", "selected"}
    assert expected_keys.issubset(row.keys())
    # pixel座標のxyxy（0〜1正規化ではない）でリサイズ後画像内に収まる
    assert 0.0 <= row["x1"] < row["x2"] <= float(width)
    assert 0.0 <= row["y1"] < row["y2"] <= float(height)
    assert row["x2"] > 1.5 or row["y2"] > 1.5  # 正規化座標との取り違え検知
    assert 0.0 <= row["confidence"] <= 1.0
    assert row["selected"] is True
