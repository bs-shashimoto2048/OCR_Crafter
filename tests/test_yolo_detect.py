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


def _jpeg_bytes_with_exif_orientation(width=64, height=32, orientation=6):
    """EXIF Orientation付きJPEG（スマホ縦撮り相当。6=90°回転して表示すべき画像）。"""
    img = Image.new("RGB", (width, height), (255, 255, 255))
    exif = img.getexif()
    exif[274] = orientation  # 274 = Orientation タグ
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _setup_common_dir(tmp_path, monkeypatch, names=(), builtin_downloaded=()):
    """共通/標準モデルの検索先を一時ディレクトリへ隔離する（実リポジトリのモデルを見ない）。"""
    common = tmp_path / "common_yolo"
    common.mkdir(parents=True, exist_ok=True)
    for name in names:
        (common / name).write_bytes(b"dummy")
    builtin_dir = tmp_path / "builtin_yolo"
    builtin_dir.mkdir(parents=True, exist_ok=True)
    for name in builtin_downloaded:
        (builtin_dir / name).write_bytes(b"dummy")
    monkeypatch.setattr(tib, "COMMON_YOLO_MODELS_DIR", common)
    monkeypatch.setattr(tib, "BUILTIN_YOLO_MODELS_DIR", builtin_dir)
    # 旧自動ダウンロード（リポジトリ直下）の互換検索も一時側へ向ける
    monkeypatch.setattr(tib, "PROJECT_ROOT", tmp_path)
    return common


def test_list_includes_common_models(temp_projects, monkeypatch):
    """共通 models/yolo のモデルが一覧へ含まれ、ユーザーモデルが先頭に来る。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["custom_a.pt"])
    result = tib.list_yolo_models(project_id="p1")
    assert result["common_models"] == ["custom_a.pt"]
    assert result["items"][0] == "custom_a.pt"
    for builtin in result["builtin_models"]:
        assert builtin in result["items"]


def test_list_models_have_source_downloaded_and_path(temp_projects, monkeypatch):
    """modelsへ取得元（project/common/builtin）・取得済み状態・パスが付与される。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["common_a.pt"], builtin_downloaded=["yolo11n.pt"])
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "proj_a.pt").write_bytes(b"dummy")

    result = tib.list_yolo_models(project_id="p1")
    by_key = {(row["source"], row["name"]): row for row in result["models"]}
    assert by_key[("project", "proj_a.pt")]["downloaded"] is True
    assert by_key[("project", "proj_a.pt")]["path"]
    assert by_key[("common", "common_a.pt")]["downloaded"] is True
    # 取得済み標準モデルは downloaded=True＋パスあり、未取得は downloaded=False＋パスなし
    assert by_key[("builtin", "yolo11n.pt")]["downloaded"] is True
    assert by_key[("builtin", "yolo11n.pt")]["path"]
    assert by_key[("builtin", "yolov8n.pt")]["downloaded"] is False
    assert by_key[("builtin", "yolov8n.pt")]["path"] is None


def test_list_models_same_name_kept_per_source(temp_projects, monkeypatch):
    """同名モデルは取得元ごとに独立して列挙され、後方互換のitemsではproject優先の1件になる。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["dup.pt"])
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "dup.pt").write_bytes(b"dummy")

    result = tib.list_yolo_models(project_id="p1")
    sources = sorted(row["source"] for row in result["models"] if row["name"] == "dup.pt")
    assert sources == ["common", "project"]
    assert result["items"].count("dup.pt") == 1


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


def test_resolve_source_project_only_no_fallback(temp_projects, monkeypatch):
    """source=projectはプロジェクト内のみ解決し、共通へ暗黙フォールバックしない（404相当）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["only_common.pt"])
    with pytest.raises(FileNotFoundError):
        tib.resolve_yolo_model(project_id="p1", model_name="only_common.pt", model_source="project")


def test_resolve_source_common_only_no_fallback(temp_projects, monkeypatch):
    """source=commonは共通のみ解決し、プロジェクト内へ暗黙フォールバックしない。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "only_project.pt").write_bytes(b"dummy")
    with pytest.raises(FileNotFoundError):
        tib.resolve_yolo_model(project_id="p1", model_name="only_project.pt", model_source="common")


def test_resolve_source_common_used_even_if_project_has_same_name(temp_projects, monkeypatch):
    """同名モデルが複数取得元にあっても、UIで選択した取得元（common）を必ず使用する。"""
    common = _setup_common_dir(temp_projects["tmp"], monkeypatch, names=["dup.pt"])
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    yolo_dir = paths.models / "yolo"
    yolo_dir.mkdir(parents=True, exist_ok=True)
    (yolo_dir / "dup.pt").write_bytes(b"dummy")
    resolved, source = tib.resolve_yolo_model(project_id="p1", model_name="dup.pt", model_source="common")
    assert source == "common"
    assert Path(resolved) == (common / "dup.pt").resolve()


def test_resolve_builtin_not_downloaded_raises_dedicated_error(temp_projects, monkeypatch):
    """source=builtinで未取得なら専用エラー（検出APIでは409。自動ダウンロードしない）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(tib.BuiltinYoloModelNotDownloadedError):
        tib.resolve_yolo_model(project_id="p1", model_name="yolo11n.pt", model_source="builtin")


def test_resolve_builtin_downloaded_resolves(temp_projects, monkeypatch):
    """取得済み標準モデルは builtin ディレクトリから解決される。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, builtin_downloaded=["yolo11n.pt"])
    resolved, source = tib.resolve_yolo_model(project_id="p1", model_name="yolo11n.pt", model_source="builtin")
    assert source == "builtin"
    assert Path(resolved).name == "yolo11n.pt"


def test_resolve_builtin_rejects_unknown_name(temp_projects, monkeypatch):
    """許可リスト外の標準モデル名は拒否する（任意名・任意URL不可）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(ValueError):
        tib.resolve_yolo_model(project_id="p1", model_name="evil_model.pt", model_source="builtin")


def test_legacy_resolution_does_not_auto_download(temp_projects, monkeypatch):
    """model_source未指定の後方互換順でも、未取得標準モデルは自動ダウンロードせず専用エラー。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(tib.BuiltinYoloModelNotDownloadedError):
        tib.resolve_yolo_model(project_id="p1", model_name="yolo11n.pt", model_source="")
    # 標準モデル名でもない未知の名前は明示エラー（そのままultralyticsへ渡さない）
    with pytest.raises(FileNotFoundError):
        tib.resolve_yolo_model(project_id="p1", model_name="unknown_model.pt", model_source="")


def test_download_builtin_rejects_unknown_name(temp_projects, monkeypatch):
    """取得APIは許可リスト外の名前を拒否する。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(ValueError):
        tib.download_builtin_yolo_model("../../evil.pt")


def test_download_builtin_already_downloaded_returns_without_network(temp_projects, monkeypatch):
    """取得済みなら再ダウンロードせずそのまま返す（外部通信なし）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch, builtin_downloaded=["yolo11n.pt"])
    result = tib.download_builtin_yolo_model("yolo11n.pt")
    assert result["downloaded"] is True
    assert result["already_downloaded"] is True
    assert result["source"] == "builtin"


def test_download_builtin_in_progress_raises(temp_projects, monkeypatch):
    """同名モデルの取得進行中は専用エラー（二重ダウンロード防止）。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with tib._builtin_download_lock:
        tib._builtin_downloads_in_progress.add("yolo11n.pt")
    try:
        with pytest.raises(tib.BuiltinYoloDownloadInProgressError):
            tib.download_builtin_yolo_model("yolo11n.pt")
    finally:
        with tib._builtin_download_lock:
            tib._builtin_downloads_in_progress.discard("yolo11n.pt")


def test_decode_applies_exif_orientation_once():
    """EXIF Orientation は読込時に1回だけ反映される（ブラウザ表示=Step1 と同じ向きになる）。

    反映しないと Step1（ブラウザがEXIFを自動適用）と Step2以降（サーバー生成画像）で
    画像の向きが90°ずれる不具合になる。
    """
    # Orientation=6（90°CW回転して表示）: 64x32 のピクセルは表示上 32x64（縦）になるべき
    decoded = tib._decode_image_bytes(_jpeg_bytes_with_exif_orientation(64, 32, orientation=6))
    assert (decoded.width, decoded.height) == (32, 64)
    # Orientation=1（回転なし）やEXIFなしは従来どおり
    decoded_plain = tib._decode_image_bytes(_png_bytes(64, 32))
    assert (decoded_plain.width, decoded_plain.height) == (64, 32)
    decoded_o1 = tib._decode_image_bytes(_jpeg_bytes_with_exif_orientation(64, 32, orientation=1))
    assert (decoded_o1.width, decoded_o1.height) == (64, 32)


def test_resize_preview_uses_exif_orientation():
    """Step1/Step2プレビューのoriginal_sizeがEXIF反映後（ブラウザと同じ向き）で返る。"""
    result = tib.make_resize_preview(
        _jpeg_bytes_with_exif_orientation(64, 32, orientation=6),
        long_side=640,
        use_resize=False,
        resize_axis="long",
    )
    assert result["original_size"] == [32, 64]


def test_detect_builtin_not_downloaded_raises_before_inference(temp_projects, monkeypatch):
    """検出APIは未取得標準モデルで外部通信（自動ダウンロード）せず、推論前に専用エラーを返す。"""
    _setup_common_dir(temp_projects["tmp"], monkeypatch)
    with pytest.raises(tib.BuiltinYoloModelNotDownloadedError):
        tib.detect_bboxes_with_yolo(
            image_bytes=_png_bytes(64, 32),
            long_side=640,
            use_resize=True,
            resize_axis="long",
            model_name="yolo11n.pt",
            conf_threshold=0.25,
            merge_overlaps=True,
            merge_iou_threshold=0.5,
            project_id="p1",
            model_source="builtin",
        )


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
    # 0件でも実行情報（モデル名・取得元・処理時間・前処理適用）を返す
    assert result["model_name"] == str(BUILTIN_MODEL_FILE)
    assert result["model_source"] == "path"  # 絶対パス指定のため
    assert isinstance(result["inference_time_ms"], int) and result["inference_time_ms"] >= 0
    assert isinstance(result["total_time_ms"], int) and result["total_time_ms"] >= result["inference_time_ms"]
    assert result["preprocess_applied"] is False


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
    # 有効な前処理（回転90°）は preprocess_applied=True
    assert result["preprocess_applied"] is True


@pytest.mark.skipif(not BUILTIN_MODEL_FILE.exists(), reason="yolo11n.pt がリポジトリ直下に無い")
def test_detect_noop_preprocess_is_not_applied(temp_projects, monkeypatch):
    """設定オブジェクトが存在しても無変換（noop）なら preprocess_applied=False（既存noop判定を使用）。"""
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
        detect_preprocess={"rotation": 0, "brightness": 1.0},
    )
    assert result["preprocess_applied"] is False


@pytest.mark.skipif(not REAL_MODEL_FILE.exists(), reason="共通models/yoloの実モデルが無い環境ではスキップ")
def test_detect_common_model_source(temp_projects, monkeypatch):
    """共通 models/yolo のモデルをbare名で指定すると model_source=common で解決される（読み取りのみ）。"""
    monkeypatch.setattr(tib, "COMMON_YOLO_MODELS_DIR", REAL_MODEL_FILE.parent)
    result = tib.detect_bboxes_with_yolo(
        image_bytes=_png_bytes(64, 32),
        long_side=640,
        use_resize=True,
        resize_axis="long",
        model_name=REAL_MODEL_FILE.name,
        conf_threshold=0.25,
        merge_overlaps=True,
        merge_iou_threshold=0.5,
        project_id="p1",
    )
    assert result["model_source"] == "common"
    assert result["model_name"] == REAL_MODEL_FILE.name
    assert Path(result["resolved_model"]) == REAL_MODEL_FILE.resolve()


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
