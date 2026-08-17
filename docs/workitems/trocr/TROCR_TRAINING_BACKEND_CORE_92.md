# TrOCR Training Backend Core 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88)（[TROCR_TRAINING_INVESTIGATION_88.md](TROCR_TRAINING_INVESTIGATION_88.md)） / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)（[TROCR_TRAINING_DATASET_ADAPTER_90.md](TROCR_TRAINING_DATASET_ADAPTER_90.md)） / Feature [#92](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/92)

**状態（作業時点）**: Implemented, PR review pending。

## 目的

Investigation #88で確定した実装分割の第2段階として、Issue #90のDataset Adapterを入力境界に使用し、TrOCR Training Backend Core（Processor/Model構築・training loop・artifact保存）を実装する。Job/API/Registry/Experiment Tracking/Training UIとの統合は行わない。

## Trainer Strategy（本Issueで確定した設計判断）

Investigation #88は`Seq2SeqTrainer`を候補としていたが、実環境（`.venv`）で以下を確認した。

```
$ python -c "from transformers import Seq2SeqTrainingArguments; Seq2SeqTrainingArguments(output_dir='x')"
ImportError: Using the `Trainer` with `PyTorch` requires `accelerate>=1.1.0`:
Please run `pip install transformers[torch]` or `pip install 'accelerate>=1.1.0'`
```

`Seq2SeqTrainer`/`Seq2SeqTrainingArguments`は**`accelerate>=1.1.0`が無いと初期化自体に失敗する**ハード依存であることを実測で確認した（`requirements.txt`/`requirements-ci.txt`いずれにも`accelerate`は導入されていない）。`datasets`パッケージの追加は`Trainer`が`torch.utils.data.Dataset`互換オブジェクトを受け付けるため回避可能だが、`accelerate`は回避不能である。

「新規依存パッケージの追加は原則避ける」という既存方針（`CLAUDE.md`）と、独自training loop実装のコストを比較した結果、**`accelerate`という新規依存を追加せず、独自の最小training loopを実装する**ことを決定した（`Seq2SeqTrainer`は不採用）。`VisionEncoderDecoderModel.forward(pixel_values, labels)`が標準のcross-entropy損失計算（`labels`の`-100`をignore_indexとする既存transformers規約）をモデル内部で行うため、独自loop側で損失計算自体を再実装する必要はなく、batch化・epochループ・optimizer stepのみを実装すればよい。AMP・分散学習・LRスケジューラ・途中checkpoint保存は本Coreでは実装しない（将来必要になれば別Issueで再検討する）。

## 実装内容

### `src/app/services/trocr_engine.py`（既存ファイルへの最小拡張）

`TrOCREngine`へ読み取り専用property `processor`/`model`を追加した。既存の`predict()`/`predict_file()`・`load()`の挙動・戻り値は無変更（既存`tests/test_trocr_engine.py`・`tests/test_trocr_evaluation_predictor.py`（計78件）で無回帰を確認済み）。目的は、Training Backend Coreが`TrOCREngine.load()`をそのまま再利用してProcessor/Model構築（model_ref解決・device解決・transformers依存guard）を複製しないため。

### `src/app/services/trocr_training_core.py`（新規）

- `TrocrTrainingConfig`（frozen dataclass）: `output_dir`/`epochs`/`batch_size`/`learning_rate`/`max_target_length`/`device`/`local_files_only`。不正値（epochs<1等）は`__post_init__`で`ValueError`。
- `TrocrTrainingResult`（frozen dataclass）: `artifact_dir`/`model_ref`/`sample_count`/`epochs_completed`/`final_loss`。Model Registry登録・sidecar metadataは含まない（次Issueの責務）。
- `TrOCRTrainingRunError`/`TrOCRTrainingSaveError`（`trocr_engine.TrOCRError`のサブクラス）: training実行・保存固有の新しい失敗モードのみ専用例外を用意した。Dataset Adapterの`FileNotFoundError`/`TrocrDatasetError`、`TrOCREngine.load()`の`TrOCRDependencyError`/`TrOCRModelLoadError`はラップせずそのまま伝播させる（既存Predictor群と同じ「握りつぶさない」方針）。
- `run_trocr_training(dataset_root, model_ref, config) -> TrocrTrainingResult`: 唯一のエントリポイント。

処理フロー: Issue #90 Adapterでtrain split読込 → `TrOCREngine.load()`でProcessor/Model構築（build-once、request/run単位で1回のみ） → 画像をRGBへ変換しProcessorへ渡し`pixel_values`取得、tokenizerでlabelsを`max_length`固定長生成しpad token位置を`-100`でmask → `torch.utils.data.DataLoader`でbatch化（`shuffle=False`、決定的） → epochループでforward/backward/optimizer step（`AdamW`） → 最終lossの平均を記録 → `model.save_pretrained()`/`processor.save_pretrained()`で`output_dir`へ保存。

### Dataset Integration（既存の固定キャンバス前処理との関係）

Issue #90で確認済みの制約（既存Dataset出力画像はTesseract/PaddleOCR向け固定グレースケールキャンバスへ整形済みでraw画像は保存されない）を踏まえ、本Coreは`Image.open(path).convert("RGB")`のみを行い、追加のresize/normalize/二値化は一切実装しない（TrOCR Processor自身に委ねる）。二重前処理の可能性はFuture Workとして記録し、本Issueでは対処しない（Dataset schema変更を伴うため）。

## Tests

`tests/test_trocr_training_core.py`（新規、24件）。Fake ModelのみHugging Faceのモデルではなく実際の`torch.nn.Module`（学習可能なParameterを1つ持つ）として実装し、`loss.backward()`/`optimizer.step()`が本物のPyTorch autogradで動作すること（`test_training_actually_updates_model_weight_via_real_autograd`）を確認した（訓練ロジック自体をモックで隠さない）。

- 正常系: Dataset Adapter利用、Processor/Model build-once、model_ref/local_files_only伝播、image/text→tensor変換、padding token maskingの実値検証、training parameter propagation（epochs×batch数どおりのforward呼び出し回数）、既定device=cpu、実weight更新、artifact保存、result契約、train/eval復帰
- 異常系: Dataset Adapter失敗の非ラップ伝播（`FileNotFoundError`・`TrocrDatasetError`）、`TrOCRDependencyError`/`TrOCRModelLoadError`の非ラップ伝播、training失敗の`TrOCRTrainingRunError`ラップ、保存失敗の`TrOCRTrainingSaveError`ラップ、画像破損の`TrOCRTrainingRunError`
- Config validation: 不正値5パターン

`python -m pytest -q tests/test_trocr_training_core.py tests/test_trocr_engine.py tests/test_trocr_evaluation_predictor.py` — 全pass（既存無回帰を含む）。全体`python -m pytest -q` — 1227 passed（既存1203+新規24、既知Issue #8以外の新規failureなし）。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新

## Future Work（Scope外として記録）

- 既存Dataset出力画像の固定グレースケールキャンバス整形とTrOCR Processorの前処理が二重になっている可能性（Dataset schema変更を伴うため対応せず）
- AMP（混合精度）・分散学習・LRスケジューラ・途中checkpoint保存
- Validation split（`val.txt`）を用いた評価ループ（本Coreはtrain splitのみ使用）
- `accelerate`導入による`Seq2SeqTrainer`移行（将来、高度な学習機能が必要になった場合の代替案として記録のみ）

## Out of Scope（次Issue以降）

- `job_runner.py`統合・training API endpoint配線
- DB job lifecycle・progress/cancel API contract
- Model Registry登録・Experiment tracking書込・Dataset lineage書込
- Training UI
- Dataset schema変更・raw image保存方式変更
