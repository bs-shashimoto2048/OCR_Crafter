# [Feature] 共通Model Metadata実装

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [MODEL_METADATA.md](../../design/MODEL_METADATA.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / Refactor [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)（Engine Registry初適用、実装済み）

Phase2の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase1「共通基盤」）。TrOCR対応ではない。

## 実装結果（2026-07-30）

`src/app/services/model_metadata.py`として実装済み。詳細は[MODEL_METADATA.md](../../design/MODEL_METADATA.md)の「MVP実装済み」節を参照。要点:

- 必須フィールドは`model_id`/`engine_id`のみ。他はすべて任意
- `status`/`version`はモデルファイル自体に対応する実データが存在しないため不採用（Job状態・Release状態・各種バージョン概念とは別軸）
- `engine_id`は`resolve_engine_id()`（Engine Registry）経由で検証。**カスタム分類モデルの`engine="custom"`はEngine Registry未登録のため、現時点のModelMetadataでは表現できない**（既知の制約として記録）
- `extra`は`MappingProxyType` + deep copyで外部からの変更を防止
- `from_dict()`は未知フィールドを無視する（自動でextraへ混入しない）
- 既存処理への配線・既存JSON書き換え・Adapter実装（`from_ocr_metadata()`等）は行っていない

## 背景

現在、OCRモデルのメタデータはエンジンごとに異なる形式で保存されている（PaddleOCR系`.ocr.json`／Tesseract系`.tess.json`／カスタム分類`.pt`／`inference_model.json`／学習履歴（`training_jobs`テーブル）／実験カルテ（`experiments.json`）／Benchmark結果（`benchmarks.json`））。そのため、モデル一覧・評価・推論・リリース判定などで共通して参照できる統一的なModel Metadata構造が必要。

## 事前調査結果（実装前に確認済み）

既存の全モデル関連メタデータ形式を調査した。

| 形式 | 実フィールド例 | 備考 |
|---|---|---|
| `.ocr.json`（PaddleOCR） | `engine, model_type, train_dir/checkpoint_dir, infer_dir/inference_dir/model_dir, charset, max_text_length, image_shape, dataset_root/dataset_id/dataset_name, job_id, training_params{20項目}, dataset_split_ratio/counts, preprocess{...}, augmentation{enabled,strength}` | モデル実体パスが`model_dir`/`inference_dir`/`checkpoint_dir`の3エイリアスで併存 |
| `.tess.json`（Tesseract） | `engine, lang/base_lang/charset, traineddata_path/tessdata_dir/model_dir, dataset_root, job_id, max_iterations, experiment_name, training_duration_seconds(null可), dataset_split_ratio(null可), training_preprocess(null可)` | 旧モデルで多数のフィールドがNone（後方互換コメントあり） |
| `.pt`（カスタム分類） | `state_dict, classes, model_type, project_id, image_size, dataset_split_ratio/counts, training_mode, init_source_*` | `engine`はcheckpoint内に存在せず`model_registry.py`がハードコードで`"custom"`を補完 |
| `inference_model.json` | `engine, model, inference_model_id, updated_at` | `created_at`/`status`相当の概念なし |
| `training_jobs`テーブル | 36列。`status`実値は`queued/running/succeeded/failed/cancel_requested/cancelled/interrupted` | Job単位の情報でありModel単位ではない |
| 実験カルテ（`experiments.json`） | `experiment_id(EXP-0001), source("training"\|"backfill"), dataset_id/dataset_name/dataset_hash, model_engine, training{...}, preprocess{version,...}` | `source`はライブ記録かバックフィルかを表す既存の実概念 |
| Benchmark結果（`benchmarks.json`） | `benchmark_id(BM-0001), engine, model, cer, ...` | モデル横断比較用、Model Metadata本体ではない |
| `release_gate.py` | `_model_engine()`はファイル拡張子のみで`.tess.json`→tesseract/`.ocr.json`→paddleocrを判定（メタ内`engine`フィールドは見ない） | 既存の重複ロジック（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)でも既知の課題として記録済み、未着手） |

**「バージョン」は3つの別概念が併存**（`release_manager.py`のリリース版番（Draft→Candidate→Production）／`preprocess.version`（前処理設定バージョン）／`RELEASES_SCHEMA_VERSION`（レジストリのスキーマ版）」であり、モデルファイル自体が持つ単一の「モデルバージョン」概念は存在しない。**「モデルのstatus」も、モデルファイル自体には存在しない**（Job状態・Release状態はそれぞれ別テーブル/別ファイルの概念）。

## 目的

エンジン非依存の共通Model Metadata型と、既存メタデータから安全に構築するための最小APIを実装する。

## 今回の実装範囲

- `ModelMetadata`（frozen dataclass）
- 必須・任意フィールドの定義
- `to_dict()`
- `from_dict()`
- 既存Engine Registryとの整合確認（`resolve_engine_id()`を再利用、正規化ロジックを複製しない）
- バリデーション
- 単体テスト
- 設計ドキュメント更新

## 対象外

- 既存JSONファイルの自動移行
- 既存モデルファイルの書き換え
- DBスキーマ変更
- OCR推論処理への適用
- Training / Evaluation / Benchmarkへの適用
- TrOCR実装
- Frontend変更
- [Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)修正
- [Issue #12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)修正
- 各エンジン形式ごとの変換Adapter（`from_ocr_metadata()`等、後続Issueで個別に検討）

## Backend変更

`src/app/services/model_metadata.py`を新規追加。既存ファイル（`model_registry.py`/`ocr_pipeline.py`/`predict.py`/`job_runner.py`/`ocr_evaluation.py`/`release_gate.py`/`benchmark.py`/`experiment_tracker.py`/`dataset_registry.py`）は一切変更しない。

## API変更

なし

## UI変更

なし

## データ構造・永続化への影響

なし（新規モジュールの追加のみ。既存JSON・DBスキーマは変更しない）

## テスト観点

- 正常系: 最小構成/全任意項目/to_dict/from_dict/round trip/登録済み4エンジン/extra保持/immutable性/独立インスタンス間の状態非共有
- 異常系: model_id・engine_idのNone/空文字/空白のみ/未知engine/不正型/必須フィールド欠損/extraがdict以外/extra内部mutable値の分離/未知フィールド/共通フィールドとextraの衝突
- 互換性: 既存メタデータ代表例でのfrom_dict/None任意項目/ISO日時文字列/旧データ相当の最小入力
- 既存テストスイート（`python -m pytest -q`）が全て通過する（[Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)起因の既知失敗を除く）

## 受け入れ条件

- [x] `ModelMetadata`を実装している（必須: `model_id`/`engine_id`のみ）
- [x] `to_dict()`/`from_dict()`がround trip可能
- [x] `engine_id`が`resolve_engine_id()`経由でEngine Registryと整合し、正規化ロジックを複製していない
- [x] `extra`が外部から変更できない（MappingProxyType + deep copy）
- [x] 単体テストを追加し通過する
- [x] 既存コード・既存JSONを変更していない
- [x] 既存テストスイートに影響がない

## 補足資料

- [MODEL_METADATA.md](../../design/MODEL_METADATA.md)
- [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
