from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ImportImagesRequest(BaseModel):
    source_dir: str = Field(..., description="取り込み元ディレクトリ")
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")


class PreprocessRequest(BaseModel):
    project_id: Optional[str] = "default"
    overrides: Optional[dict[str, Any]] = None


class LabelUpdateRequest(BaseModel):
    label: str


class DatasetBuildRequest(BaseModel):
    project_id: Optional[str] = "default"
    train_ratio: float = 0.7
    val_ratio: float = 0.2
    test_ratio: float = 0.1
    seed: int = 42


class TrainRequest(BaseModel):
    project_id: Optional[str] = "default"
    model_type: str = Field(default="square")
    epochs: int = Field(default=5, ge=1, le=500)
    batch_size: int = Field(default=32, ge=1, le=1024)
    learning_rate: float = Field(default=1e-3, gt=0)
    training_mode: Literal["scratch", "finetune"] = Field(default="finetune")
    init_source_type: Literal["scratch", "imagenet", "classification_model"] = Field(default="imagenet")
    init_source_value: Optional[str] = Field(default=None)
    freeze_backbone_epochs: int = Field(default=1, ge=0, le=100)
    backbone_lr_scale: float = Field(default=0.1, gt=0, le=1.0)


class ProjectCreateRequest(BaseModel):
    project_id: str = Field(..., description="新規プロジェクトID")


class DirectorySelectRequest(BaseModel):
    initial_dir: Optional[str] = Field(default=None, description="初期表示ディレクトリ")


class FileSelectRequest(BaseModel):
    initial_dir: Optional[str] = Field(default=None, description="初期表示ディレクトリ")
    extensions: Optional[list[str]] = Field(default=None, description="許可拡張子（未指定時は pt）")


class RotateImageRequest(BaseModel):
    angle: int = Field(..., description="回転角度（90の倍数。右回転が正）")


class PreprocessPreviewRequest(BaseModel):
    image: str = Field(..., description="プレビュー対象の画像ファイル名")
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")
    engine: str = Field(default="custom", description="推論エンジン: custom/easyocr/paddleocr/tesseract")
    model: str = Field(default="latest", description="custom/paddleocr/tesseract時のモデル指定 (tesseractはengでベースモデル指定可)")
    model_type: Optional[str] = Field(default=None, description="custom+latest時のモデル種別")
    easyocr_langs: str = Field(default="en", description="OCR使用言語 (comma separated)")


class EvaluateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    dataset: str = Field(default="val", pattern="^(val|test)$")
    model: str = Field(default="latest", description="latest またはモデルファイル名")
    model_type: Optional[str] = Field(default=None, description="latest選択時のモデル種別絞り込み")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")


class AppShutdownRequest(BaseModel):
    frontend_port: Optional[int] = Field(default=None, description="フロントエンド開発サーバーのポート")


class OcrTuningExportRequest(BaseModel):
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    engine: str = Field(default="both", description="easyocr / paddleocr / both")
    output_dir: Optional[str] = Field(default=None, description="出力先ディレクトリ（未指定時はproject outputs配下）")
    image_types: list[str] = Field(default_factory=lambda: ["wide"], description="対象画像種別: single / wide")
    train_ratio: float = Field(default=0.8, gt=0)
    val_ratio: float = Field(default=0.1, ge=0)
    test_ratio: float = Field(default=0.1, ge=0)
    seed: int = Field(default=42)
    overwrite: bool = Field(default=False)


class OcrDatasetCreateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    image_types: list[str] = Field(default_factory=lambda: ["wide"])
    charset: str = Field(default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    max_text_length: int = Field(default=8, ge=1, le=64)
    image_shape: list[int] = Field(default_factory=lambda: [3, 48, 320])
    use_augmentation: bool = Field(default=False)
    aug_strength: int = Field(default=1, ge=1, le=3)
    train_ratio: float = Field(default=0.8, gt=0)
    val_ratio: float = Field(default=0.1, ge=0)
    test_ratio: float = Field(default=0.1, ge=0)
    seed: int = Field(default=42)
    output_dir: Optional[str] = Field(default=None)
    overwrite: bool = Field(default=False)
    text_case: Literal["upper", "lower", "keep"] = Field(
        default="upper", description="ラベル/文字セットの大小文字処理（Tesseractの小文字学習はlower）"
    )


class OcrEvalTarget(BaseModel):
    engine: str = Field(default="tesseract", description="評価エンジン（現状 tesseract）")
    model: str = Field(default="latest", description="'eng'（学習前）/ '<name>.tess.json' / 'latest'")


class OcrEvaluateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    image_dir: str = Field(..., description="評価用画像フォルダ")
    gt_csv: str = Field(..., description="正解CSV（画像名,正解文字列）")
    targets: list[OcrEvalTarget] = Field(
        default_factory=lambda: [OcrEvalTarget(engine="tesseract", model="eng"), OcrEvalTarget(engine="tesseract", model="latest")]
    )
    charset: str = Field(
        default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt",
        description="評価時whitelist。既定=実運用(A-Z/0-9/klt)、空文字=whitelistなし、任意文字列=カスタム",
    )
    psm: int = Field(default=7, ge=0, le=13)


class TesseractTrainStartRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    dataset_dir: str = Field(..., description="OCRデータ作成で生成したデータセットディレクトリ")
    charset: str = Field(
        default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt",
        description="学習対象文字セット（A-Z / 0-9 / 小文字筆記体 k,l,t）。whitelistとは別概念",
    )
    max_iterations: int = Field(default=1000, ge=1, le=100000, description="LSTM fine-tuneの最大イテレーション")
    base_lang: str = Field(default="eng", description="fine-tuneのベース言語(traineddata)")
    psm: int = Field(default=7, ge=0, le=13, description="単一行認識用のPage Segmentation Mode")


class OcrTrainStartRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    engine: str = Field(default="paddleocr")
    dataset_dir: str = Field(...)
    paddle_repo_dir: Optional[str] = Field(default=None)
    charset: str = Field(default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    max_text_length: int = Field(default=8, ge=1, le=64)
    image_shape: list[int] = Field(default_factory=lambda: [3, 48, 320])
    batch_size: int = Field(default=16, ge=1, le=1024)
    epochs: int = Field(default=30, ge=1, le=2000)
    device: Literal["auto", "cpu", "gpu"] = Field(default="auto")
    auto_batch_size: Optional[bool] = Field(default=None)
    train_num_workers: Optional[int] = Field(default=None, ge=0, le=32)
    eval_num_workers: Optional[int] = Field(default=None, ge=0, le=32)
    save_epoch_step: Optional[int] = Field(default=None, ge=1, le=1000)
    use_amp: Optional[bool] = Field(default=None)
    pin_memory: Optional[bool] = Field(default=None)
    persistent_workers: Optional[bool] = Field(default=None)
    training_mode: Literal["scratch", "finetune"] = Field(default="scratch")
    init_source_type: Literal["scratch", "ocr_model"] = Field(default="scratch")
    init_source_value: Optional[str] = Field(default=None)


class OcrLogSaveRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    image_path: str = Field(...)
    predicted_text: str = Field(default="")
    corrected_text: Optional[str] = Field(default=None)
    confidence: Optional[float] = Field(default=None)
    is_valid: bool = Field(default=False)
    reason: Optional[str] = Field(default=None)
    model_name: Optional[str] = Field(default=None)
    engine: Optional[str] = Field(default=None)
    char_scores: Optional[list[float]] = Field(default=None)
    used_retry: Optional[bool] = Field(default=None)
    multi_ocr: Optional[bool] = Field(default=None)
    extra: Optional[dict[str, Any]] = Field(default=None)


class OcrDatasetFromLogsRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    only_invalid: bool = Field(default=True)
    include_corrected: bool = Field(default=True)
    max_text_length: int = Field(default=8, ge=1, le=64)
    charset: str = Field(default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    image_shape: list[int] = Field(default_factory=lambda: [3, 48, 320])
    output_dir: Optional[str] = Field(default=None)
    overwrite: bool = Field(default=False)
    text_case: Literal["upper", "lower", "keep"] = Field(
        default="upper", description="ログ由来テキストの大小文字処理（Tesseractの小文字学習はlower）"
    )
