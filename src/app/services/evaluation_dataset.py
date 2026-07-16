"""学習画像作成 Step5（評価用データ作成）のバックエンド。

- Step4出力のマニフェスト（image_builder_exports/<export_id>/manifest.json）を候補として読み込み、
  評価データセット（data/projects/<project_id>/evaluation/<dataset_id>/）を作成する。
- 学習用クロップ（Step4出力）は変更せず、評価用コピーへのみ回転を焼き込む。
- CSVは既存モデル評価（services/ocr_evaluation.py の _read_gt_csv）が読める
  「filename,label」形式（utf-8-sig・csv.writer・case-sensitive）で出力する。
"""

import csv
import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from PIL import Image, ImageOps

from ..paths import IMAGE_EXTENSIONS
from ..project_paths import get_project_paths, safe_rmtree

# データセット名: 英数字・ハイフン・アンダースコアのみ（パストラバーサル防止）
_DATASET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_VALID_ROTATIONS = {0, 90, 180, 270}
# editing_state.json の上限（画像データ等の巨大JSON書き込み防止）
_STATE_MAX_BYTES = 2 * 1024 * 1024


def _exports_dir(project_id: str) -> Path:
    return get_project_paths(project_id).root / "image_builder_exports"


def _evaluation_dir(project_id: str) -> Path:
    return get_project_paths(project_id).root / "evaluation"


def sanitize_dataset_id(name: str) -> str:
    """データセット名を検証して返す。未入力は日時ベースの既定名を生成。"""
    candidate = str(name or "").strip()
    if not candidate:
        return f"eval_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    if not _DATASET_ID_PATTERN.match(candidate):
        raise ValueError(
            "データセット名は英数字・ハイフン・アンダースコア（64文字以内）のみ使用できます"
        )
    return candidate


def list_export_candidates(project_id: str) -> dict[str, Any]:
    """Step4出力マニフェストから評価候補（クロップ一覧）を返す。

    対応関係は画像名からの推測ではなく、出力時に保存された manifest.json を根拠とする。
    出力先（外部フォルダ）のファイルが消えている場合は exists=False で返す。
    """
    exports_root = _exports_dir(project_id)
    exports: list[dict[str, Any]] = []
    if exports_root.exists():
        for manifest_path in sorted(exports_root.glob("*/manifest.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if str(manifest.get("project_id") or "") != str(project_id):
                continue
            output_dir = Path(str(manifest.get("output_dir") or ""))
            crops = []
            missing = 0
            for crop in manifest.get("crops") or []:
                filename = str(crop.get("filename") or "")
                if not filename:
                    continue
                source = output_dir / filename
                exists = source.exists() and source.is_file()
                if not exists:
                    missing += 1
                crops.append(
                    {
                        "export_id": str(manifest.get("export_id") or ""),
                        "filename": filename,
                        "series": str(crop.get("series") or ""),
                        "bbox_id": crop.get("bbox_id"),
                        "exists": exists,
                    }
                )
            exports.append(
                {
                    "export_id": str(manifest.get("export_id") or ""),
                    "created_at": str(manifest.get("created_at") or ""),
                    "source_image": str(manifest.get("source_image") or ""),
                    "model_name": str(manifest.get("model_name") or ""),
                    "model_source": str(manifest.get("model_source") or ""),
                    "selected_series": manifest.get("selected_series"),
                    "output_dir": str(output_dir),
                    "crop_count": len(crops),
                    "missing_count": missing,
                    "crops": crops,
                }
            )
    # 新しい出力を先頭へ
    exports.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return {"project_id": project_id, "exports": exports}


def resolve_export_crop_path(project_id: str, export_id: str, filename: str) -> Path:
    """マニフェストに記録されたクロップだけを解決する（任意パス参照・トラバーサル防止）。"""
    safe_export = Path(str(export_id or "")).name
    if not safe_export or safe_export != export_id:
        raise ValueError("invalid export_id")
    manifest_path = _exports_dir(project_id) / safe_export / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"エクスポート履歴が見つかりません: {export_id}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    safe_name = Path(str(filename or "")).name
    known = {str(crop.get("filename")) for crop in manifest.get("crops") or []}
    if not safe_name or safe_name != filename or safe_name not in known:
        raise FileNotFoundError(f"マニフェストに存在しない画像です: {filename}")
    source = Path(str(manifest.get("output_dir") or "")) / safe_name
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(f"クロップ画像が見つかりません: {source}")
    return source


def _apply_rotation(img: Image.Image, rotation: int) -> Image.Image:
    """時計回りの回転を適用（0/90/180/270）。EXIFはStep4クロップ生成時に反映済みのため再解釈しない。"""
    if rotation == 90:
        return img.transpose(Image.ROTATE_270)  # PILは反時計回りなので270=時計回り90°
    if rotation == 180:
        return img.transpose(Image.ROTATE_180)
    if rotation == 270:
        return img.transpose(Image.ROTATE_90)
    return img


def load_export_crop_image(project_id: str, export_id: str, filename: str, rotation: int = 0) -> Image.Image:
    """プレビュー・サムネイル用にクロップを読み込み、指定回転を適用して返す（元ファイルは変更しない）。"""
    if int(rotation) not in _VALID_ROTATIONS:
        raise ValueError("rotation must be one of 0/90/180/270")
    source = resolve_export_crop_path(project_id, export_id, filename)
    with Image.open(source) as img:
        return _apply_rotation(img.convert("RGB"), int(rotation))


def _resolve_directory(directory: str) -> Path:
    text = str(directory or "").strip()
    if not text:
        raise ValueError("フォルダパスを指定してください")
    path = Path(text)
    if not path.exists() or not path.is_dir():
        raise FileNotFoundError(f"フォルダが見つかりません: {text}")
    return path


def list_directory_images(directory: str) -> dict[str, Any]:
    """指定フォルダ直下の画像一覧（評価画像の取得方法=directoryモード）。サブフォルダは対象外。"""
    path = _resolve_directory(directory)
    images = sorted(
        entry.name for entry in path.iterdir() if entry.is_file() and entry.suffix.lower() in IMAGE_EXTENSIONS
    )
    return {
        "directory": str(path.resolve()),
        "image_count": len(images),
        "images": [{"filename": name} for name in images],
    }


def resolve_directory_image_path(directory: str, filename: str) -> Path:
    """フォルダ直下の画像だけを解決する（パス区切り・トラバーサル・非画像拡張子を拒否）。"""
    root = _resolve_directory(directory)
    safe_name = Path(str(filename or "")).name
    if not safe_name or safe_name != filename:
        raise ValueError(f"invalid filename: {filename}")
    if Path(safe_name).suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"未対応の画像形式です: {safe_name}")
    source = root / safe_name
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(f"画像が見つかりません: {source}")
    return source


def _exif_orientation(path: Path) -> int:
    """EXIF Orientationタグ（無し・読めない場合は1=そのまま）。"""
    try:
        with Image.open(path) as img:
            return int(img.getexif().get(0x0112, 1) or 1)
    except Exception:  # noqa: BLE001
        return 1


def load_directory_image(directory: str, filename: str, rotation: int = 0) -> Image.Image:
    """フォルダ画像をプレビュー/OCR入力用に読み込む。

    任意画像はEXIF Orientation付きの可能性があるため、読込時に1回だけ反映してから
    ユーザー回転を適用する（ブラウザ表示と向きを一致させる。元ファイルは変更しない）。
    """
    if int(rotation) not in _VALID_ROTATIONS:
        raise ValueError("rotation must be one of 0/90/180/270")
    source = resolve_directory_image_path(directory, filename)
    with Image.open(source) as img:
        oriented = ImageOps.exif_transpose(img)
        return _apply_rotation(oriented.convert("RGB"), int(rotation))


def load_editing_state(project_id: str) -> dict[str, Any]:
    """Step5の途中保存状態（プロジェクト単位）。無ければ空dict。"""
    path = _evaluation_dir(project_id) / "editing_state.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_editing_state(project_id: str, state: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(state, dict):
        raise ValueError("state must be an object")
    text = json.dumps(state, ensure_ascii=False, indent=2)
    if len(text.encode("utf-8")) > _STATE_MAX_BYTES:
        raise ValueError("editing_state が大きすぎます（画像データ等は保存できません）")
    root = _evaluation_dir(project_id)
    root.mkdir(parents=True, exist_ok=True)
    (root / "editing_state.json").write_text(text, encoding="utf-8")
    return {"saved": True}


def _load_dataset_metadata(dataset_dir: Path) -> Optional[dict[str, Any]]:
    metadata_path = dataset_dir / "metadata.json"
    if not metadata_path.exists():
        return None
    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def list_evaluation_datasets(project_id: str) -> dict[str, Any]:
    """作成済み評価データセットの一覧（モデル評価画面の選択候補）。metadata.jsonを根拠にする。"""
    root = _evaluation_dir(project_id)
    datasets: list[dict[str, Any]] = []
    if root.exists():
        for dataset_dir in sorted(root.iterdir()):
            if not dataset_dir.is_dir():
                continue
            metadata = _load_dataset_metadata(dataset_dir)
            if metadata is None:
                continue
            images = metadata.get("images") or []
            series = sorted({str(row.get("series") or "") for row in images if str(row.get("series") or "")})
            label_count = sum(1 for row in images if str(row.get("label") or "").strip())
            rotated_count = sum(1 for row in images if int(row.get("rotation") or 0) % 360 != 0)
            csv_file = str(metadata.get("csv_file") or "ground_truth.csv")
            datasets.append(
                {
                    "id": dataset_dir.name,
                    "name": str(metadata.get("dataset_id") or dataset_dir.name),
                    "created_at": str(metadata.get("created_at") or ""),
                    "image_count": int(metadata.get("image_count") or len(images)),
                    "label_count": label_count,
                    "series": series,
                    "rotated_count": rotated_count,
                    "dataset_dir": str(dataset_dir.resolve()),
                    "image_dir": str((dataset_dir / "images").resolve()),
                    "csv_path": str((dataset_dir / csv_file).resolve()),
                }
            )
    datasets.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return {"project_id": project_id, "datasets": datasets}


def _resolve_dataset_dir(project_id: str, dataset_id: str) -> Path:
    safe_id = Path(str(dataset_id or "")).name
    if not safe_id or safe_id != dataset_id or not _DATASET_ID_PATTERN.match(safe_id):
        raise ValueError("invalid dataset_id")
    dataset_dir = _evaluation_dir(project_id) / safe_id
    if not dataset_dir.exists() or not dataset_dir.is_dir():
        raise FileNotFoundError(f"評価データセットが見つかりません: {dataset_id}")
    return dataset_dir


def delete_evaluation_dataset(project_id: str, dataset_id: str) -> dict[str, Any]:
    """評価データセット一式（images/CSV/metadata/editing_state）を削除する。safe_rmtreeで配下検証。"""
    dataset_dir = _resolve_dataset_dir(project_id, dataset_id)
    safe_rmtree(dataset_dir, allowed_roots=[_evaluation_dir(project_id)], label="evaluation dataset")
    return {"deleted": True, "dataset_id": dataset_id}


def rename_evaluation_dataset(project_id: str, dataset_id: str, new_name: str) -> dict[str, Any]:
    """データセット名を変更する。CSV・画像はディレクトリ内相対参照のため壊れない。metadataは更新する。"""
    dataset_dir = _resolve_dataset_dir(project_id, dataset_id)
    next_id = sanitize_dataset_id(new_name)
    if next_id == dataset_id:
        return {"dataset_id": dataset_id, "renamed": False}
    target = _evaluation_dir(project_id) / next_id
    if target.exists():
        raise ValueError(f"同名の評価データセットが既に存在します: {next_id}")
    dataset_dir.rename(target)
    metadata = _load_dataset_metadata(target) or {}
    metadata["dataset_id"] = next_id
    (target / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"dataset_id": next_id, "renamed": True, "dataset_dir": str(target.resolve())}


def _sha256_of(path: Path) -> Optional[str]:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _iter_training_images(project_id: str, max_files: int = 20000) -> list[Path]:
    """学習データ（OCRデータ作成の出力 outputs/ocr_dataset/*/{train,val,test}）の画像一覧。"""
    root = get_project_paths(project_id).outputs / "ocr_dataset"
    files: list[Path] = []
    if not root.exists():
        return files
    for dataset_dir in root.iterdir():
        if not dataset_dir.is_dir():
            continue
        for split in ("train", "val", "test"):
            split_dir = dataset_dir / split
            if not split_dir.exists():
                continue
            for path in split_dir.rglob("*"):
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                    files.append(path)
                    if len(files) >= max_files:
                        return files
    return files


def check_training_overlap(project_id: str, dataset_id: str) -> dict[str, Any]:
    """評価データセットと学習データの重複を判定する（評価値の過大化防止のための警告用）。

    判定優先順位: ①sha256完全一致 → ②元画像+BBoxID（学習画像のsha256をStep4マニフェストへ
    引き当てて出自を特定し、回転等でバイトが変わっても同一クロップを検出）→ ③元ファイル名。
    """
    dataset_dir = _resolve_dataset_dir(project_id, dataset_id)
    metadata = _load_dataset_metadata(dataset_dir) or {}
    images_dir = dataset_dir / "images"
    eval_images = metadata.get("images") or []

    training_files = _iter_training_images(project_id)
    training_shas: set[str] = set()
    training_names: set[str] = set()
    for path in training_files:
        training_names.add(path.name)
        sha = _sha256_of(path)
        if sha:
            training_shas.add(sha)

    # Step4マニフェスト: sha256 → (元画像, BBoxID)。学習画像がStep4出力由来なら出自を引き当てられる
    sha_to_source: dict[str, tuple[str, Any]] = {}
    exports_root = _exports_dir(project_id)
    if exports_root.exists():
        for manifest_path in exports_root.glob("*/manifest.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            source_image = str(manifest.get("source_image") or "")
            for crop in manifest.get("crops") or []:
                sha = str(crop.get("sha256") or "")
                if sha:
                    sha_to_source[sha] = (source_image, crop.get("bbox_id"))
    training_sources = {sha_to_source[sha] for sha in training_shas if sha in sha_to_source}

    overlaps: list[dict[str, Any]] = []
    for row in eval_images:
        filename = str(row.get("filename") or "")
        matched_by = ""
        sha = _sha256_of(images_dir / filename) if filename else None
        if sha and sha in training_shas:
            matched_by = "sha256"
        elif (
            (str(row.get("source_image") or ""), row.get("source_bbox_id")) in training_sources
            and str(row.get("source_image") or "")
        ):
            matched_by = "source_bbox"
        elif str(row.get("source_filename") or "") and str(row.get("source_filename")) in training_names:
            matched_by = "filename"
        if matched_by:
            overlaps.append({"filename": filename, "matched_by": matched_by})

    return {
        "project_id": project_id,
        "dataset_id": dataset_id,
        "training_image_count": len(training_files),
        "evaluation_image_count": len(eval_images),
        "overlap_count": len(overlaps),
        "overlaps": overlaps[:100],
    }


def create_evaluation_dataset(
    project_id: str,
    dataset_name: str,
    items: list[dict[str, Any]],
    editing_state: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """評価データセットを作成する（画像コピー＋回転焼き込み＋CSV＋metadata）。

    - 入力元は Step4出力（source=step4、既定）または 任意フォルダ（source=directory）
    - 未入力ラベルがある場合は作成を拒否（空文字をCSVへ出力しない）
    - 元画像（Step4出力・フォルダ画像）は読み取りのみで変更しない
    - 画像名は step4=<export_id>_<元ファイル名> / directory=元ファイル名（重複時は連番付与）
    """
    dataset_id = sanitize_dataset_id(dataset_name)
    if not items:
        raise ValueError("評価対象画像がありません")

    # 入力元の判定（metadataのsourceを一意にするため、step4とdirectoryの混在は不可）
    source_modes = {str(row.get("source") or "step4") for row in items}
    if not source_modes <= {"step4", "directory"}:
        raise ValueError("source は step4 / directory のいずれかを指定してください")
    if len(source_modes) > 1:
        raise ValueError("Step4出力とフォルダ画像を同一データセットへ混在させることはできません")
    source_mode = source_modes.pop()
    source_directory = ""
    if source_mode == "directory":
        dirs = {str(row.get("source_directory") or "").strip() for row in items}
        if len(dirs) != 1 or not next(iter(dirs)):
            raise ValueError("source_directory を指定してください（単一フォルダのみ）")
        source_directory = next(iter(dirs))

    unlabeled = [row for row in items if not str(row.get("label") or "").strip()]
    if unlabeled:
        raise ValueError(f"未入力の正解ラベルが{len(unlabeled)}件あります。全件入力後に作成してください")

    for row in items:
        rotation = int(row.get("rotation") or 0)
        if rotation not in _VALID_ROTATIONS:
            raise ValueError("rotation must be one of 0/90/180/270")

    dataset_dir = _evaluation_dir(project_id) / dataset_id
    if dataset_dir.exists():
        raise ValueError(f"同名の評価データセットが既に存在します: {dataset_id}")

    # 先に全ソースを解決（1件でも見つからなければ作成しない）
    resolved: list[tuple[dict[str, Any], Path]] = []
    missing: list[str] = []
    for row in items:
        try:
            if source_mode == "directory":
                source = resolve_directory_image_path(source_directory, str(row.get("filename")))
            else:
                source = resolve_export_crop_path(project_id, str(row.get("export_id")), str(row.get("filename")))
            resolved.append((row, source))
        except (FileNotFoundError, ValueError):
            if source_mode == "directory":
                missing.append(str(row.get("filename")))
            else:
                missing.append(f"{row.get('export_id')}/{row.get('filename')}")
    if missing:
        raise FileNotFoundError(
            f"評価画像が見つからないため作成できません（{len(missing)}件）: " + ", ".join(missing[:5])
        )

    images_dir = dataset_dir / "images"
    try:
        images_dir.mkdir(parents=True, exist_ok=False)
        csv_rows: list[tuple[str, str]] = []
        image_entries: list[dict[str, Any]] = []
        used_names: set[str] = set()
        for row, source in resolved:
            rotation = int(row.get("rotation") or 0)
            # ラベルはcase-sensitiveのまま保持（大小文字を変更しない）
            label = str(row.get("label"))
            if source_mode == "directory":
                # EXIF Orientation付きは向きを焼き込む（評価パイプラインはEXIFを解釈しないため、
                # ブラウザで見た向きと評価入力の向きを一致させる）。回転・EXIFなしはバイト等価コピー
                bake = rotation != 0 or _exif_orientation(source) != 1
                base_name = f"{source.stem}.png" if bake else source.name
                out_name = base_name
                counter = 2
                while out_name in used_names:
                    out_name = f"{Path(base_name).stem}_{counter}{Path(base_name).suffix}"
                    counter += 1
            else:
                bake = rotation != 0
                out_name = f"{row.get('export_id')}_{Path(str(row.get('filename'))).name}"
            used_names.add(out_name)
            target = images_dir / out_name
            if not bake:
                shutil.copyfile(source, target)
                with Image.open(target) as img:
                    width, height = img.size
            else:
                with Image.open(source) as img:
                    oriented = ImageOps.exif_transpose(img) if source_mode == "directory" else img
                    rotated = _apply_rotation(oriented.convert("RGB"), rotation)
                    rotated.save(target, format="PNG")
                    width, height = rotated.size
            csv_rows.append((out_name, label))
            image_entries.append(
                {
                    "filename": out_name,
                    "label": label,
                    "rotation": rotation,
                    "width": width,
                    "height": height,
                    "series": str(row.get("series") or ""),
                    "source_export_id": str(row.get("export_id") or "") if source_mode == "step4" else "",
                    "source_filename": str(row.get("filename") or ""),
                    "source_image": str(row.get("source_image") or "") if source_mode == "step4" else "",
                    "source_bbox_id": row.get("bbox_id") if source_mode == "step4" else None,
                }
            )

        # 既存モデル評価が読む形式: filename,label（ヘッダーは既知キーとしてスキップされる）
        csv_path = dataset_dir / "ground_truth.csv"
        with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["filename", "label"])
            writer.writerows(csv_rows)

        # source: step4=Step4出力由来 / directory=任意フォルダ由来
        # （旧データセットの "training_image_builder" は step4 と同義。読む側はこの値に依存しない）
        metadata = {
            "dataset_id": dataset_id,
            "project_id": project_id,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "source": source_mode,
            "image_count": len(csv_rows),
            "case_sensitive": True,
            "csv_file": "ground_truth.csv",
            "images": image_entries,
        }
        if source_mode == "directory":
            metadata["source_directory"] = source_directory
        (dataset_dir / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if isinstance(editing_state, dict):
            (dataset_dir / "editing_state.json").write_text(
                json.dumps(editing_state, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    except Exception:
        # 途中失敗時は不完全なデータセットを残さない
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise

    return {
        "dataset_id": dataset_id,
        "dataset_dir": str(dataset_dir.resolve()),
        "image_dir": str(images_dir.resolve()),
        "csv_path": str(csv_path.resolve()),
        "image_count": len(csv_rows),
    }
