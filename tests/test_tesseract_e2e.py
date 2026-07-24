"""Tesseract 軽量E2Eテスト: データセット作成→小規模学習→モデル一覧→評価→削除。

Tesseract本体・学習ツール（lstmtraining/combine_tessdata）・tessdata_best の
eng.traineddata が揃っていない環境では skip する。
すべて一時ディレクトリ（PROJECTS_DIRパッチ済み）で完結し、実データに触れない。
実行時間の目安: 1〜2分（学習4枚×50イテレーション）。
"""

import csv

import pytest
from PIL import Image, ImageDraw, ImageFont


def tesseract_tools_available() -> bool:
    """Tesseract本体+学習ツール+tessdata_best が揃っているか（skip判定）。"""
    try:
        from src.app.services.tesseract_pipeline import (
            resolve_base_traineddata,
            resolve_tesseract_tools,
        )

        tools = resolve_tesseract_tools()
        if not all(tools.get(k) for k in ("tesseract", "lstmtraining", "combine_tessdata")):
            return False
        resolve_base_traineddata("eng", tesseract_cmd=tools["tesseract"])
        return True
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(
    not tesseract_tools_available(),
    reason="tesseract本体/学習ツール/tessdata_best(eng.traineddata) が未導入のためskip",
)

PROJECT = "e2etest"
CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-"
FONT_DIR = r"C:\Windows\Fonts"


def _render_label(text: str, out_path, font_name: str = "arialbd.ttf") -> None:
    try:
        font = ImageFont.truetype(rf"{FONT_DIR}\{font_name}", size=48)
    except OSError:
        font = ImageFont.load_default()
    tmp = Image.new("L", (10, 10), 250)
    box = ImageDraw.Draw(tmp).textbbox((0, 0), text, font=font)
    img = Image.new("L", (box[2] - box[0] + 60, box[3] - box[1] + 40), 250)
    ImageDraw.Draw(img).text((30 - box[0], 20 - box[1]), text, fill=20, font=font)
    img.save(out_path)


@pytest.fixture()
def e2e_project(temp_projects):
    """一時プロジェクトにラベル付き画像4枚を用意する。"""
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories(PROJECT)
    labels = {"e2e_0.png": "CHYBkt", "e2e_1.png": "A12Blt", "e2e_2.png": "VT20kt", "e2e_3.png": "K9Z3lt"}
    with paths.annotations_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["filename", "label", "type"])
        for name, label in labels.items():
            _render_label(label, paths.raw / name)
            writer.writerow([name, label, "wide"])
    return {"paths": paths, "labels": labels}


def test_lightweight_e2e(e2e_project):
    from src.app.services.model_registry import delete_model, list_models
    from src.app.services.ocr_evaluation import evaluate_ocr
    from src.app.services.ocr_pipeline import create_ocr_dataset
    from src.app.services.tesseract_pipeline import run_tesseract_training

    paths = e2e_project["paths"]
    labels = e2e_project["labels"]

    # 1. データセット作成（text_case=keep / 新charset）
    created = create_ocr_dataset(
        project_id=PROJECT,
        image_types=["wide"],
        charset=CHARSET,
        text_case="keep",
        max_text_length=64,
        image_shape=[1, 48, 320],
        train_ratio=0.75,
        val_ratio=0.25,
        test_ratio=0.0,
        overwrite=False,
    )
    dataset_root = created["dataset_root"]
    train_txt = (paths.outputs / "ocr_dataset").rglob("train.txt")
    joined = "".join(p.read_text(encoding="utf-8") for p in train_txt)
    assert "CHYBkt" in joined or "VT20kt" in joined  # keepで無改変

    # 2. 小規模学習（50イテレーション）
    result = run_tesseract_training(
        project_id=PROJECT,
        job_id="pytest-e2e",
        dataset_dir=dataset_root,
        charset=CHARSET,
        max_iterations=50,
        base_lang="eng",
        psm=7,
    )
    assert result["charset"] == CHARSET

    # 3. モデル一覧に登録される
    models = list_models(PROJECT)
    tess_models = [m for m in models if m.endswith(".tess.json")]
    assert len(tess_models) == 1

    # 4. 評価（eng vs latest、case-sensitive・実運用whitelist）
    gt_csv = paths.outputs / "e2e_gt.csv"
    with gt_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["filename", "text"])
        for name, label in list(labels.items())[:2]:
            writer.writerow([name, label])
    evaluation = evaluate_ocr(
        project_id=PROJECT,
        image_dir=str(paths.raw),
        gt_csv=str(gt_csv),
        targets=[{"engine": "tesseract", "model": "eng"}, {"engine": "tesseract", "model": "latest"}],
        charset=CHARSET,
        psm=7,
    )
    assert evaluation["count"] == 2
    assert len(evaluation["targets"]) == 2
    assert evaluation["comparison"] is not None
    assert evaluation["charset"] == CHARSET

    # 5. 削除（実体ごと消え、modelsルートは無傷）
    model_name = tess_models[0]
    delete_model(PROJECT, model_name)
    assert model_name not in list_models(PROJECT)
    assert not (paths.models / "tesseract" / model_name.replace(".tess.json", "")).exists()
    assert paths.models.exists()
