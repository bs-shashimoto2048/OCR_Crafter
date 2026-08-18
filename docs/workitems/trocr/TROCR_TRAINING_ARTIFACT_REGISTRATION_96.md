# TrOCR Training Artifact Registration 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88) / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)（Dataset Adapter） / Feature [#92](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/92)（Training Backend Core） / Feature [#94](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/94)（Job Integration） / Feature [#96](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/96)

**状態**: Completed・Closed。PR [#97](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/97)をSquash Merge・mainへ反映済み、Merge Commit: `6a0c0c7`。Issue #96はPR本文の`Closes #96`によりマージ時に自動Close。

## 目的

Investigation #88で確定した実装分割の第4段階として、Issue #94で既存Training Job lifecycleへ接続したTrOCR学習成果物を、既存のModel Registry / artifact契約へ安全に登録する。ModelMetadata新層の全面配線は行わず、既存`.tess.json`/`.ocr.json`パターンを踏襲した最小互換方式を選ぶ。

## 実装前調査（既存Registry / Artifact Call Graph）

- `model_registry.py::list_models()`/`list_model_infos()`は`*.pt`/`*.ocr.json`/`*.tess.json`のみをglobする、拡張子がハードコードされた実装。`list_model_infos()`はTesseract/PaddleOCRそれぞれに200行超の専用フィールド構築ロジックを持つ`elif`分岐であり、ここへ第3分岐を追加することは既存2エンジンへの回帰リスクが大きいと判断した
- `tesseract_pipeline.py::register_tesseract_model()`は`.tess.json`をatomic_write_jsonで書込み（「メタ書込＝正式登録の完了マーカー」という設計）、その後`experiment_tracker.record_experiment()`を呼ぶが、**実験記録の失敗はモデル登録自体の成功に影響させない**（try/exceptで囲みログのみ）という既存precedentを確認した
- **重要な発見**: TrOCRのInference経路（`predict.py::_predict_with_trocr()`）・Evaluation経路（`TrOCREvaluationPredictor`）はいずれも`model_registry.py`のresolve系関数を一切使わない。呼び出し側が渡した`model`パラメータ（Hugging Face Hub ID・ローカルディレクトリパス）を`TrOCREngine.load()`へそのまま渡すだけの既存契約（Issue #18で確定、Investigation #88で再確認）。したがって「登録済みモデルをInference/Evaluationへ安全に渡せる契約」は、**artifact directoryのパス文字列をそのままmodel_refとして渡すだけで既に満たされる**（save_pretrained()で書き出したディレクトリはfrom_pretrained()でそのまま読み込める、Hugging Face標準の対称性）。新しい解決層は不要
- `dataset_registry.py::resolve_dataset_id_safe(project_id, dataset_root)`はEngine非依存かつ「学習完了直後の登録処理からの呼び出し」を想定した設計（失敗時は空文字を返しモデル登録自体は失敗させない）であることを確認し、そのまま再利用した
- `experiment_tracker.record_experiment(project_id, payload)`は完全に汎用的な自由形式payloadを受け取る実装であり、Engine固有の変更は不要と確認した

## 設計判断: `model_registry.py`への統合は行わない

上記調査に基づき、**本Issueでは`model_registry.py`の共有関数（`list_models()`/`list_model_infos()`）への統合を行わない**ことを決定した。理由:

1. Inference/Evaluationへの安全な受け渡しは、artifact directoryパスをそのまま使うだけで既に達成される（新しい解決層は不要）
2. `list_model_infos()`は200行超のEngine別分岐を持つ複雑な共有関数であり、ここへの変更はTesseract/PaddleOCRへの回帰リスクを伴う
3. Issue #96自身が「3. `ModelMetadata`新層の全面配線が必要になる場合は本Issueで独断実装せず、境界を文書化して別Issueへ分離」を明示的に許容している

TrOCR専用の`.trocr.json`sidecar・専用の一覧関数のみを新設した。一般Modelsリスト（ModelsView等）への統合はTraining UI Issueへ境界として引き継ぐ（Future Work）。

## 実装内容

### `src/app/services/trocr_model_registry.py`（新規）

- `TrocrModelRecord`（frozen dataclass）: `name`/`engine`/`model_dir`/`base_model_ref`/`project_id`/`job_id`/`dataset_dir`/`dataset_id`/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`created_at`
- `TrocrRegistrationError`（`ValueError`のサブクラス）
- `register_trocr_model(project_id, *, job_id, model_dir, base_model_ref, dataset_dir, epochs, batch_size, learning_rate, final_loss=None)`: artifact完全性検証（`config.json`存在確認）→ 重複識別子検証（`models/trocr_<job_id>.trocr.json`が既に存在しないか）→ `atomic_write_json`でsidecar書込 → 実験カルテ記録（best-effort、失敗しても登録成功のまま）
- `list_trocr_models(project_id)`: `.trocr.json`sidecarをそのまま読み込む専用一覧関数

### `main.py::_run_trocr_training_job()`（Issue #94からの追加配線）

`run_trocr_training()`成功直後、`status="completed"`確定前に`register_trocr_model()`を呼ぶ。既存の`try/except`にそのまま乗せることで、登録失敗（`TrocrRegistrationError`）は既存の失敗処理へ自然に合流し、job は`failed`として記録される（登録失敗を完了扱いにしない、Issue #96 Registration Timing要件）。

### Required Metadata / Lineage

`engine`/`model_dir`/`base_model_ref`/`project_id`/`job_id`/`dataset_dir`/`dataset_id`（`resolve_dataset_id_safe()`経由）/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`created_at`を保存。秘密情報・不要な絶対path露出はない（`model_dir`はプロジェクトローカルのファイルシステムpathであり、既存`.tess.json`の`traineddata_path`等と同じ性質）。

### Experiment Tracking

Tesseractの既存precedent（実験記録失敗はモデル登録に影響させない）をそのまま踏襲し、`experiment_tracker.record_experiment()`を再利用した。`training`予約サブオブジェクトへ`optimizer="AdamW"`・`epochs`・`batch_size`・`learning_rate`・`loss`を実測値として保存する（Tesseractはこれらの概念が無くNoneのままだが、TrOCRには実在するため実測値を保存。既存キー名は変更しない）。

## 重大なインシデントと是正（レビュー前セルフチェックで検出）

実装中、`tests/test_trocr_training_job.py`の一部テスト（`_run_trocr_training_job()`のlifecycleテスト）が`temp_projects`フィクスチャを使わずに実行されており、新設した`register_trocr_model()`経由の`ensure_project_directories()`/`resolve_dataset_id_safe()`呼び出しが**実際のリポジトリの`data/projects/p1/`・`data/dataset_ids.json`（実データ）へ書き込んでいた**ことを発見した。

- 影響: `data/projects/p1/models/trocr_job-1.trocr.json`・`data/projects/p1/experiments.json`（新規作成）、`data/dataset_ids.json`への不正エントリ`"p1/dataset": "DS0034"`追加（`counter`が33→34に増加）
- 対応: 上記の新規作成ファイルを削除し、`data/dataset_ids.json`の`counter`を33へ復元、不正エントリを削除して実データを元の状態へ復旧した
- 再発防止: 該当テスト全てへ`temp_projects`フィクスチャを追加し、`project_paths.PROJECTS_DIR`を一時ディレクトリへ隔離した。修正後、`data/projects/`配下・`data/dataset_ids.json`への書き込みが発生しないことを確認済み

この経緯は`CLAUDE.md`の「`data/projects/` 実データ｜テストは隔離する」という既存ルールの重要性を再確認する事例であり、透明性のためここに記録する。

## Tests

`tests/test_trocr_model_registry.py`（新規、15件）:

- 正常系: sidecar作成・全フィールド検証、final_loss省略時のNone・dataset_dir未指定時のdataset_id空文字
- 異常系: job_id未指定、artifact directory不存在、`config.json`欠落（不完全artifact）、重複job_id、sidecar書込失敗
- Experiment Tracking: 失敗時も登録は成功、payload内容の検証
- `list_trocr_models()`: 空・登録済み一覧・malformed JSON無視・project別スコープ
- **Inference/Evaluation Compatibility**（Issue #96 Goals #6/#7）: 登録済み`model_dir`をそのまま`TrOCREngine.load()`/`TrOCREvaluationPredictor`のmodel_refとして渡せることを確認

`tests/test_trocr_training_job.py`は既存16件を維持しつつ、`_run_trocr_training_job()`の成功パステストで実際に`register_trocr_model()`が動作するよう`_make_artifact_dir()`ヘルパー（`config.json`を含む実ディレクトリ生成）へ更新した。

`python -m pytest -q` — 1258 passed, 1 failed（既知Issue #8のみ、新規failureなし）。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新

## Future Work（Scope外として記録）

- `model_registry.py::list_models()`/`list_model_infos()`への統合（一般Modelsリスト・ModelsView UIでのTrOCR表示。Training UI Issueへ引き継ぐ）
- Dataset⇔Modelクロス参照（`dataset_registry.py::_dataset_root_of_model()`）への接続（`dataset_root`フィールド名は既に揃えてあるが、`list_model_infos()`未統合のため現状は接続されない）
- TrOCR jobのworker異常終了時の自動復旧・部分登録の検出（Issue #94のFuture Workと同様）

## Out of Scope（次Issue以降）

- ModelMetadata infrastructureの全面配線・移行
- Training UI / Models UIの大規模変更
- Dataset schema変更 / raw image保存方式変更
- Training Core / optimizer semantics変更
- Evaluation Runner / Metrics変更
- Benchmark統合・Release Gate統合
