from typing import Any, Optional

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


class ProjectCreateRequest(BaseModel):
    project_id: str = Field(..., description="新規プロジェクトID")


class DirectorySelectRequest(BaseModel):
    initial_dir: Optional[str] = Field(default=None, description="初期表示ディレクトリ")


class RotateImageRequest(BaseModel):
    angle: int = Field(..., description="回転角度（90の倍数。右回転が正）")


class PreprocessPreviewRequest(BaseModel):
    image: str = Field(..., description="プレビュー対象の画像ファイル名")
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")
    engine: str = Field(default="custom", description="推論エンジン: custom/easyocr")
    model: str = Field(default="latest", description="custom時のモデル指定")
    model_type: Optional[str] = Field(default=None, description="custom+latest時のモデル種別")
    easyocr_langs: str = Field(default="en", description="easyocr使用言語 (comma separated)")


class EvaluateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    dataset: str = Field(default="val", pattern="^(val|test)$")
    model: str = Field(default="latest", description="latest またはモデルファイル名")
    model_type: Optional[str] = Field(default=None, description="latest選択時のモデル種別絞り込み")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")


class AppShutdownRequest(BaseModel):
    frontend_port: Optional[int] = Field(default=None, description="フロントエンド開発サーバーのポート")
