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


class AnalyzeMaskRegionRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    x: float = Field(..., ge=0.0, le=1.0, description="クリック位置X（元画像に対する正規化座標）")
    y: float = Field(..., ge=0.0, le=1.0, description="クリック位置Y（元画像に対する正規化座標）")
    threshold: int = Field(default=80, ge=0, le=255, description="黒判定しきい値（画素値<=threshold）")


class ManualMasksUpdateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    manual_masks: list[dict] = Field(default_factory=list, description="画像単位の手動マスク一覧")


class PreprocessPreviewRequest(BaseModel):
    image: str = Field(..., description="プレビュー対象の画像ファイル名")
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")
    engine: str = Field(default="custom", description="推論エンジン: custom/easyocr/paddleocr/tesseract")
    model: str = Field(default="latest", description="custom/paddleocr/tesseract時のモデル指定 (tesseractはengでベースモデル指定可)")
    model_type: Optional[str] = Field(default=None, description="custom+latest時のモデル種別")
    easyocr_langs: str = Field(default="en", description="OCR使用言語 (comma separated)")
    include_lowercase: bool = Field(
        default=True,
        description="小文字を出力に含める（EasyOCR/PaddleOCRのラテン言語時のみ有効。未指定はtrue）",
    )
    # OCR結果確認用の推論パラメータ（Tesseractのみ）。未指定=従来動作
    psm: Optional[int] = Field(default=None, ge=0, le=13, description="Tesseract PSM（未指定=既定7）")
    whitelist: Optional[str] = Field(default=None, description="Tesseract whitelist（未指定=モデル既定charset）")


class EvaluateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default", description="プロジェクトID")
    dataset: str = Field(default="val", pattern="^(val|test)$")
    model: str = Field(default="latest", description="latest またはモデルファイル名")
    model_type: Optional[str] = Field(default=None, description="latest選択時のモデル種別絞り込み")
    overrides: Optional[dict[str, Any]] = Field(default=None, description="前処理設定の上書き")


class AppShutdownRequest(BaseModel):
    frontend_port: Optional[int] = Field(default=None, description="フロントエンド開発サーバーのポート")


class EvaluationStateSaveRequest(BaseModel):
    """Step5（評価用データ作成）の途中保存状態（プロジェクト単位）。"""

    project_id: Optional[str] = Field(default="default")
    state: dict[str, Any] = Field(default_factory=dict, description="編集状態（ラベル・回転・評価対象・フィルタ等）")


class EvaluationDatasetItem(BaseModel):
    """評価データセットへ含める1画像（Step4出力マニフェスト由来 または 指定フォルダの画像）。"""

    export_id: str = Field(default="", description="Step4出力のexport_id（source=step4のとき必須）")
    filename: str = Field(..., description="出力フォルダ/指定フォルダ内のファイル名")
    label: str = Field(..., description="正解ラベル（case-sensitive）")
    rotation: int = Field(default=0, description="評価用コピーへ焼き込む回転角（0/90/180/270）")
    series: Optional[str] = Field(default="")
    source_image: Optional[str] = Field(default="")
    bbox_id: Optional[int] = Field(default=None)
    # 未指定=step4（従来動作）。directory時は source_directory を指定する
    source: Optional[str] = Field(default="step4", description="画像の取得元（step4 / directory）")
    source_directory: Optional[str] = Field(default="", description="source=directoryのときの画像フォルダパス")


class EvaluationDatasetRenameRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    new_name: str = Field(..., description="新しいデータセット名（英数字・ハイフン・アンダースコア）")


class EvaluationDatasetCreateRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    dataset_name: str = Field(default="", description="データセット名（未入力は日時ベースの既定名）")
    items: list[EvaluationDatasetItem] = Field(default_factory=list)
    editing_state: Optional[dict[str, Any]] = Field(default=None, description="作成時点の編集状態スナップショット")


class BuiltinYoloDownloadRequest(BaseModel):
    """Ultralytics標準モデルの明示取得リクエスト（許可リスト内の名前のみ）。"""

    # pydantic v2 の model_ 名前空間警告を抑止（APIキー名は model_name を維持）
    model_config = {"protected_namespaces": ()}

    model_name: str = Field(description="取得する標準モデル名（例: yolo11n.pt）")


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
    # 新形式の学習時オーグメンテーション設定（Trainのみへ適用・元画像は必ず残す）。
    # {preset, multiplier, rotation:{enabled,max_degrees,probability}, brightness/contrast:{enabled,range,probability},
    #  blur/noise:{enabled,strength,probability}}。None/preset=none=未使用（従来動作）
    augmentation: Optional[dict] = Field(default=None, description="学習時オーグメンテーション設定（Trainのみ）")


class OcrDatasetSplitPreviewRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    image_types: list[str] = Field(default_factory=lambda: ["wide"])
    charset: str = Field(default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    max_text_length: int = Field(default=8, ge=1, le=64)
    text_case: Literal["upper", "lower", "keep"] = Field(default="upper")
    train_ratio: float = Field(default=0.8, gt=0)
    val_ratio: float = Field(default=0.1, ge=0)
    test_ratio: float = Field(default=0.1, ge=0)


class OcrAugmentationPreviewRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    image_types: list[str] = Field(default_factory=lambda: ["wide"])
    charset: str = Field(default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    max_text_length: int = Field(default=8, ge=1, le=64)
    text_case: Literal["upper", "lower", "keep"] = Field(default="upper")
    image_shape: list[int] = Field(default_factory=lambda: [3, 48, 320])
    augmentation: dict = Field(..., description="プレビューするオーグメンテーション設定")
    sample_count: int = Field(default=3, ge=1, le=5)


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
        default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
        description="評価時whitelist。既定=実運用(A-Z/0-9/klt/+-)、空文字=whitelistなし、任意文字列=カスタム",
    )
    psm: int = Field(default=7, ge=0, le=13)
    # Step5と共通の評価前処理（services/preprocess.py の apply_eval_preprocess を共用）。
    # 未指定=前処理なし（従来動作・後方互換）
    eval_preprocess: Optional[dict[str, Any]] = Field(
        default=None,
        description="評価前処理（{grayscale, binarize, binarize_method: otsu/fixed, threshold: 0-255}。未指定=従来動作）",
    )
    preprocess_source: Optional[str] = Field(
        default="none", description="前処理設定の由来（none/step5/custom。応答へそのまま反映し履歴表示に使う）"
    )
    # 評価前処理モード（none/manual/training/training_individual）。
    # 未指定=旧動作（eval_preprocessの有無でmanual/none）・後方互換
    preprocess_mode: Optional[str] = Field(
        default=None,
        description="評価前処理モード（none=前処理なし / manual=手動設定 / training=学習時前処理を共通適用 / "
        "training_individual=各モデルの学習時前処理を個別適用。未指定=従来動作）",
    )


class TrainingPreprocessPreviewRequest(BaseModel):
    """モデルの学習時前処理を適用したプレビュー（評価・推論画面用）。"""

    project_id: Optional[str] = Field(default="default")
    model: str = Field(default="latest", description="学習時前処理を参照するモデル（.tess.json / .ocr.json / latest）")
    directory: str = Field(..., description="プレビュー対象画像のフォルダ")
    filename: str = Field(..., description="プレビュー対象の画像ファイル名")


class ExperimentUpdateRequest(BaseModel):
    """実験カルテの編集可能フィールド（タグ・お気に入り・メモ・学習者・実験名）。"""

    project_id: Optional[str] = Field(default="default")
    tags: Optional[list[str]] = Field(default=None, description="自由タグ（例: Baseline / Best / 失敗 / Aug試験）")
    favorite: Optional[bool] = Field(default=None, description="★固定（重要実験のピン留め）")
    note: Optional[str] = Field(default=None, description="メモ")
    operator: Optional[str] = Field(default=None, description="学習者")
    experiment_name: Optional[str] = Field(default=None, description="実験名")


class JobCreateRequest(BaseModel):
    """バックグラウンドジョブの作成（既存処理をJobとして実行する）。"""

    project_id: Optional[str] = Field(default="default")
    job_type: str = Field(..., description="preprocess / dataset_creation / training / evaluation / benchmark / deployment_export")
    params: dict[str, Any] = Field(default_factory=dict, description="ハンドラへ渡す入力条件（種別ごと）")
    requested_by: str = Field(default="", description="実行者（operator名）")


class JobRetryRequest(BaseModel):
    requested_by: str = Field(default="", description="再実行者（未指定=元Jobの実行者）")


class BenchmarkCreateRequest(BaseModel):
    """OCR Benchmark実行（Job Management経由でjob_type=benchmarkを作成）。"""

    project_id: Optional[str] = Field(default="default")
    name: str = Field(default="", description="Benchmark表示名（Profile Hashへは含めない）")
    image_dir: str = Field(..., description="評価画像フォルダ")
    gt_csv: str = Field(..., description="正解CSV（画像名,正解文字列）")
    dataset_id: str = Field(default="", description="評価データセットID（任意）")
    engines: list[dict[str, Any]] = Field(
        default_factory=list,
        description="対象エンジン一覧 [{engine: tesseract_model/tesseract_base/paddleocr_official, model?, psm?, whitelist?}]",
    )
    warmup_runs: Optional[int] = Field(default=1, description="ウォームアップ実行回数（統計へ含めず回数のみ記録）")
    preprocess: Optional[dict[str, Any]] = Field(
        default=None,
        description="前処理計画 {mode: none/manual/training/project, settings?（manual）, model?（training）}。未指定=none（従来動作）",
    )
    requested_by: str = Field(default="", description="実行者（operator名）")


class ReportGenerateRequest(BaseModel):
    """モデル開発レポートの生成（Job Management経由でjob_type=report_generateを作成）。"""

    project_id: Optional[str] = Field(default="default")
    report_type: str = Field(default="single_model", description="single_model / comparison / project_summary")
    model_ids: list[str] = Field(default_factory=list, description="対象モデル（single=1件 / comparison=2件以上）")
    formats: list[str] = Field(default_factory=lambda: ["markdown"], description="markdown / pdf（両方指定可）")
    include_images: bool = Field(default=False, description="代表失敗例の画像を同梱ディレクトリへコピーして掲載")
    experiments_limit: Optional[int] = Field(default=50, description="実験履歴の掲載件数（総括レポート）")
    template_info: Optional[dict[str, Any]] = Field(default=None, description="作成元テンプレート情報（フロント保存値）")
    project_description: str = Field(default="", description="プロジェクト概要（ユーザー入力）")
    purpose: str = Field(default="", description="OCR用途（ユーザー入力）")
    created_by: str = Field(default="", description="作成者")


class BackupCreateRequest(BaseModel):
    """プロジェクトバックアップの作成（metadata_only / full）。"""

    project_id: Optional[str] = Field(default="default")
    mode: str = Field(default="metadata_only", description="metadata_only=設定・記録のみ / full=プロジェクト全体")


class BackupRestoreRequest(BaseModel):
    """バックアップの復元（既定で新しいProject IDへ。既存プロジェクトは上書きしない）。"""

    new_project_id: str = Field(default="", description="復元先Project ID（未指定=<元ID>_restored_<n> を自動採番）")


class RetentionConfigRequest(BaseModel):
    """データ保持設定（未設定=無期限保持=従来動作）。"""

    job_retention_days: Optional[int] = Field(default=None, description="終端状態Jobの保持日数（null=無期限）")
    audit_retention_days: Optional[int] = Field(default=None, description="監査ログの保持日数（null=無期限）")


class BenchmarkConfigRequest(BaseModel):
    """バランス最良スコアの重み設定（プロジェクト毎）。"""

    project_id: Optional[str] = Field(default="default")
    balance_weights: dict[str, Any] = Field(..., description="{accuracy, speed, stability}（合計1へ正規化）")


class ReleaseStatusRequest(BaseModel):
    """モデルステータスの手動変更（Draft / Validated / Candidate / Archived）。"""

    project_id: Optional[str] = Field(default="default")
    model: str = Field(..., description="対象モデル（<name>.tess.json 等）")
    status: str = Field(..., description="Draft / Validated / Candidate / Archived（ProductionはpromoteのみでArchived化も自動）")


class ReleasePromoteRequest(BaseModel):
    """Productionへの昇格（Release Note必須・旧Productionは自動Archived）。"""

    project_id: Optional[str] = Field(default="default")
    model: str = Field(..., description="昇格するモデル")
    note: str = Field(..., description="Release Note（変更点・理由。必須）")
    author: str = Field(default="", description="リリース実施者")
    # 例外承認（Release Gate判定FAILのモデルを昇格する場合は両方必須）
    override_reason: str = Field(default="", description="Override理由（Gate FAIL時の例外承認）")
    approved_by: str = Field(default="", description="承認者（Gate FAIL時の例外承認）")
    version: Optional[str] = Field(default=None, description="バージョン（未指定=直近Productionのマイナー加算。初回1.0.0）")


class ReleasePolicyRequest(BaseModel):
    """Release Policy（プロジェクト毎のGateルール設定）の保存。"""

    project_id: Optional[str] = Field(default="default")
    policy: dict[str, Any] = Field(
        default_factory=dict,
        description="max_cer / min_char_accuracy / min_exact_match / min_eval_images / max_failed / "
        "no_cer_regression / require_same_evaluation_hash / min_comparison_quality / "
        "required_chars{chars, min_accuracy} / critical_confusions[{from, to, severity, max_count}] / "
        "max_benchmark_rank / allowed_engines[]（未設定キー=ルール無効）",
    )


class ReleaseRollbackRequest(BaseModel):
    """過去のリリースVersionへのロールバック（Version維持・新Release ID・rollback=true）。"""

    project_id: Optional[str] = Field(default="default")
    version: str = Field(..., description="戻す対象のリリースVersion")
    author: str = Field(default="", description="実施者")
    note: str = Field(default="", description="理由（未指定は自動文言）")


class ExperimentAnalysisToggleRequest(BaseModel):
    """実験の分析対象ON/OFF（失敗・途中停止・デバッグ実験の除外）。"""

    project_id: Optional[str] = Field(default="default")
    enabled: bool = Field(..., description="true=推薦・相関分析の対象 / false=対象外")


class ExperimentEvaluationAttachRequest(BaseModel):
    """評価実行結果を該当実験（モデル名で解決）へ保存する。"""

    project_id: Optional[str] = Field(default="default")
    model: str = Field(..., description="評価したモデル（<name>.tess.json）")
    evaluation: dict[str, Any] = Field(
        default_factory=dict,
        description="評価要約（cer / char_accuracy / accuracy_percent / improved / regressed / evaluated_at / dataset）",
    )


class TesseractTrainStartRequest(BaseModel):
    project_id: Optional[str] = Field(default="default")
    dataset_dir: str = Field(..., description="OCRデータ作成で生成したデータセットディレクトリ")
    charset: str = Field(
        default="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
        description="学習対象文字セット（A-Z / 0-9 / 小文字筆記体 k,l,t / 記号 +,-）。whitelistとは別概念",
    )
    max_iterations: int = Field(default=1000, ge=1, le=100000, description="LSTM fine-tuneの最大イテレーション")
    base_lang: str = Field(default="eng", description="fine-tuneのベース言語(traineddata)")
    psm: int = Field(default=7, ge=0, le=13, description="単一行認識用のPage Segmentation Mode")
    # 実験情報（学習条件比較用。未指定=従来動作でメタへは空値保存）
    experiment_name: str = Field(default="", description="実験名（モデルメタへ保存し学習条件比較で表示）")
    parent_model_id: str = Field(default="", description="親モデルの管理No（派生関係の追跡用。ベース直学習は空）")
    training_note: str = Field(default="", description="学習メモ（変更内容などの自由記述）")


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
