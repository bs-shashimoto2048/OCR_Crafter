from typing import Optional

from pydantic import BaseModel, Field


class ImportImagesRequest(BaseModel):
    source_dir: str = Field(..., description="取り込み元ディレクトリ")
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")


class PreprocessRequest(BaseModel):
    project_id: Optional[str] = "default"
    grayscale_enabled: Optional[bool] = None
    resize_enabled: Optional[bool] = None
    resize_width: Optional[int] = None
    resize_height: Optional[int] = None
    padding_enabled: Optional[bool] = None
    padding_fill: Optional[int] = None
    normalize_enabled: Optional[bool] = None
    normalize_mean: Optional[float] = None
    normalize_std: Optional[float] = None


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
    model_type: str = Field(default="square", pattern="^(square|wide)$")
    epochs: int = Field(default=5, ge=1, le=500)
    batch_size: int = Field(default=32, ge=1, le=1024)
    learning_rate: float = Field(default=1e-3, gt=0)


class ProjectCreateRequest(BaseModel):
    project_id: str = Field(..., description="新規プロジェクトID")


class DirectorySelectRequest(BaseModel):
    initial_dir: Optional[str] = Field(default=None, description="初期表示ディレクトリ")


class RotateImageRequest(BaseModel):
    angle: int = Field(..., description="回転角度（90の倍数。右回転が正）")
