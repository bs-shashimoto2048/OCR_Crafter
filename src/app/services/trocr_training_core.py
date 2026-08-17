"""TrOCR Training Backend Core（Issue #92）。

**目的は新しいDataset読込・Model構築ロジックを作ることではない。** Issue #90の
Dataset Adapter（`trocr_dataset_adapter.py`）とIssue #16の推論コア（`trocr_engine.py::
TrOCREngine`）をそのまま入力境界として再利用し、Hugging Face `VisionEncoderDecoderModel`
のfine-tuning本体（Processor/Model構築 → image/text→tensor変換 → training loop →
`save_pretrained()`互換artifact保存）のみを実装する。

```text
Issue #90 Dataset Adapter（train.txt読込・検証）
        ↓
Issue #16 TrOCREngine.load()（Processor/Model構築・device解決。既存推論コアそのまま再利用）
        ↓
本モジュール（Training Backend Core）: image/text→tensor変換・training loop・artifact保存
        ↓
（次Issue: Job Integration / Artifact Registration / Training UI）
```

## Trainer Strategy（Issue #92で確定した設計判断）

Investigation #88はHugging Face `Seq2SeqTrainer`（`transformers.Trainer`のサブクラス）を
候補としていたが、実環境（`.venv`）で確認した結果、`Seq2SeqTrainingArguments`/
`Seq2SeqTrainer`は**`accelerate>=1.1.0`が無いとImportErrorで初期化自体に失敗する**
ハード依存であることを確認した（`requirements.txt`/`requirements-ci.txt`いずれにも
`accelerate`は導入されていない）。`Trainer`は`datasets.Dataset`を必須とはしない
（`torch.utils.data.Dataset`互換オブジェクトを渡せる）ため`datasets`パッケージの追加は
回避できるが、`accelerate`は回避不能である。

「新規依存パッケージの追加は原則避ける」という既存方針と、既存依存（`torch`/
`transformers`のみ）で完結する独自training loopの実装コストを比較した結果、**本Issueでは
`accelerate`という新規依存を追加せず、独自の最小training loopを実装する**ことを決定した
（`Seq2SeqTrainer`は不採用）。`VisionEncoderDecoderModel.forward(pixel_values, labels)`が
標準のcross-entropy損失計算（`labels`の`-100`をignore_indexとして扱う既存transformers
規約）をモデル内部で行うため、独自loop側で損失計算自体を再実装する必要はなく、
optimizer step・epochループ・batch化のみを実装すればよい（AMP・分散学習・LR
スケジューラ・checkpoint途中保存等の高度な機能は本Coreでは実装しない。将来必要になれば
別Issueで再検討する）。

## Base Model / Processor / Model構築

`model_ref`・`device`・`local_files_only`の解決は、既存`TrOCREngine.load()`をそのまま
呼び出すことで行う（model_ref解決規則・device解決規則・transformers依存guard・
`from_pretrained()`呼び出しのいずれも複製しない）。本Issueのために`TrOCREngine`へ
`processor`/`model`の読み取り専用propertyのみを追加した（既存の`predict()`/
`predict_file()`・推論契約は無変更、既存推論テストで無回帰を確認済み）。

## Dataset Integration

Dataset読込・検証は`trocr_dataset_adapter.py::load_trocr_training_samples()`を
そのまま呼び出す（manifest parsingを複製しない）。既存Dataset出力画像は
`ocr_pipeline.py::create_ocr_dataset()`の時点でTesseract/PaddleOCR向け固定
グレースケールキャンバスへ既に整形済みであり、raw画像は保存されていない
（Issue #88/#90で確認済みの制約）。本Coreは`PIL.Image.open(image_path).convert("RGB")`
のみを行い（grayscale画像をRGBの3チャンネルへ複製するだけで、追加のresize/
normalize/二値化等は一切行わない）、実際のresize/normalizeはTrOCR Processor自身に
委ねる。この既存の固定キャンバス整形とTrOCR Processorの前処理が二重になっている
可能性はFuture Workとして記録し、本Issueでは対処しない（Dataset schema変更を伴うため）。

## Job/API/Registry/Training UIとの非接続

本モジュールは`job_runner.py`・training API・DB job lifecycle・progress/cancel・
Model Registry登録・Experiment tracking書込・Training UIのいずれにも接続しない
（次Issue以降の責務）。呼び出し元が同期的に`run_trocr_training()`を呼ぶだけの
単体serviceとして実装する。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from PIL import Image, UnidentifiedImageError

from .trocr_dataset_adapter import load_trocr_training_samples
from .trocr_engine import TrOCREngine, TrOCRError

# training/save固有の新しい失敗モードのみ専用例外を用意する。Dataset Adapterの
# `FileNotFoundError`/`TrocrDatasetError`、`TrOCREngine.load()`の
# `TrOCRDependencyError`/`TrOCRModelLoadError`は、いずれも既存の明確な例外のため
# 独自にラップせずそのまま伝播させる（既存Predictor群と同じ「握りつぶさない」方針）。


class TrOCRTrainingRunError(TrOCRError):
    """training実行（画像前処理・forward/backward/optimizer step）中の失敗。"""


class TrOCRTrainingSaveError(TrOCRError):
    """final model/processorの`save_pretrained()`保存失敗。"""


@dataclass(frozen=True)
class TrocrTrainingConfig:
    """TrOCR Training Backend Coreのtraining parameters（明示的な契約）。

    AMP・分散学習・LRスケジューラ・途中checkpoint保存は意図的に含まない
    （本Coreの「最低限」の方針。必要になれば別Issueで拡張する）。
    """

    output_dir: Path
    epochs: int = 1
    batch_size: int = 1
    learning_rate: float = 5e-5
    max_target_length: int = 32
    device: Optional[str] = None
    local_files_only: bool = False

    def __post_init__(self) -> None:
        if int(self.epochs) < 1:
            raise ValueError(f"epochs must be >= 1, got {self.epochs!r}")
        if int(self.batch_size) < 1:
            raise ValueError(f"batch_size must be >= 1, got {self.batch_size!r}")
        if float(self.learning_rate) <= 0:
            raise ValueError(f"learning_rate must be > 0, got {self.learning_rate!r}")
        if int(self.max_target_length) < 1:
            raise ValueError(f"max_target_length must be >= 1, got {self.max_target_length!r}")


@dataclass(frozen=True)
class TrocrTrainingResult:
    """Core単体で利用可能な結果契約。

    Model Registry登録・`.trocr.json`等のsidecar metadata作成・Experiment tracking書込は
    後続Artifact Registration Issueの責務のため、ここには含めない。
    """

    artifact_dir: Path
    model_ref: str
    sample_count: int
    epochs_completed: int
    final_loss: Optional[float]


def _load_sample_tensor(image_path: Path, text: str, processor: Any, max_target_length: int) -> dict[str, Any]:
    """1 Sampleをprocessor input（`pixel_values`）とtokenizer labels（`-100`でpad maskした
    labels）へ変換する。resize/normalize等の実処理はprocessor自身に委ねる
    （モジュールdocstring「Dataset Integration」参照。追加の前処理を独自実装しない）。
    """
    import torch  # 既存の必須依存（trocr_engine.pyと同じ、遅延import）

    try:
        with Image.open(image_path) as opened:
            image = opened.convert("RGB").copy()
    except (UnidentifiedImageError, OSError) as e:
        raise TrOCRTrainingRunError(f"failed to open image file for training: {image_path}: {e}") from e

    try:
        pixel_values = processor(images=image, return_tensors="pt").pixel_values[0]
    except Exception as e:  # noqa: BLE001
        raise TrOCRTrainingRunError(f"failed to preprocess image for training: {image_path}: {e}") from e

    try:
        pad_token_id = processor.tokenizer.pad_token_id
        encoded = processor.tokenizer(
            text,
            padding="max_length",
            max_length=int(max_target_length),
            truncation=True,
        )
        # padding token部分は損失計算から除外する（transformers標準のignore_index=-100規約。
        # VisionEncoderDecoderModelはforward(labels=...)内でこの規約に従いcross-entropy
        # 損失を計算するため、本Core側で損失計算自体を再実装する必要はない）
        labels = [token if token != pad_token_id else -100 for token in encoded.input_ids]
    except Exception as e:  # noqa: BLE001
        raise TrOCRTrainingRunError(f"failed to tokenize ground truth text for training: {text!r}: {e}") from e

    return {"pixel_values": pixel_values, "labels": torch.tensor(labels, dtype=torch.long)}


def run_trocr_training(
    dataset_root: str | Path,
    model_ref: str,
    config: TrocrTrainingConfig,
) -> TrocrTrainingResult:
    """TrOCR Training Backend Coreの唯一のエントリポイント。

    Dataset読込（Issue #90 Adapter）→ Processor/Model構築（Issue #16 `TrOCREngine.load()`）→
    training loop（本モジュール、独自最小実装）→ `save_pretrained()`互換artifact保存、
    という一連の処理を同期的に実行し`TrocrTrainingResult`を返す。

    Dataset Adapter・`TrOCREngine.load()`が送出する例外（`FileNotFoundError`・
    `TrocrDatasetError`・`TrOCRDependencyError`・`TrOCRModelLoadError`）はいずれも
    ここで握りつぶさずそのまま伝播させる（Job Failureへの変換は後続Job Integration
    Issueの責務）。
    """
    # 1. Dataset読込（既存Adapterをそのまま利用。trainのみ。評価ループは本Coreに含めない）
    samples = load_trocr_training_samples(dataset_root, split="train")

    # 2. Processor/Model構築（既存TrOCREngine.load()をそのまま利用。model_ref/device解決・
    #    transformers依存guardを複製しない）
    engine = TrOCREngine.load(model_ref, device=config.device, local_files_only=config.local_files_only)
    processor = engine.processor
    model = engine.model

    import torch
    from torch.optim import AdamW
    from torch.utils.data import DataLoader, Dataset

    class _TrocrTrainingDataset(Dataset):
        def __len__(self) -> int:
            return len(samples)

        def __getitem__(self, index: int) -> dict[str, Any]:
            sample = samples[index]
            return _load_sample_tensor(sample.image_path, sample.text, processor, config.max_target_length)

    loader = DataLoader(_TrocrTrainingDataset(), batch_size=int(config.batch_size), shuffle=False)
    optimizer = AdamW(model.parameters(), lr=float(config.learning_rate))

    # 3. training loop（独自最小実装。AMP・分散学習・LRスケジューラは持たない）
    model.train()
    final_loss: Optional[float] = None
    try:
        for _epoch in range(int(config.epochs)):
            epoch_losses: list[float] = []
            for batch in loader:
                pixel_values = batch["pixel_values"].to(engine.device)
                labels = batch["labels"].to(engine.device)
                outputs = model(pixel_values=pixel_values, labels=labels)
                loss = outputs.loss
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                epoch_losses.append(float(loss.item()))
            if epoch_losses:
                final_loss = sum(epoch_losses) / len(epoch_losses)
    except TrOCRTrainingRunError:
        raise
    except Exception as e:  # noqa: BLE001
        raise TrOCRTrainingRunError(f"training failed for model_ref={model_ref!r}: {e}") from e
    finally:
        model.eval()

    # 4. Artifact保存（save_pretrained()互換directory。Model Registry登録は次Issueの責務）
    output_dir = Path(config.output_dir).expanduser().resolve()
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(output_dir)
        processor.save_pretrained(output_dir)
    except Exception as e:  # noqa: BLE001
        raise TrOCRTrainingSaveError(f"failed to save trained model to {output_dir}: {e}") from e

    return TrocrTrainingResult(
        artifact_dir=output_dir,
        model_ref=model_ref,
        sample_count=len(samples),
        epochs_completed=int(config.epochs),
        final_loss=final_loss,
    )
