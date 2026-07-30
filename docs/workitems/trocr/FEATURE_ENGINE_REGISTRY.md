# [Feature] Engine Registry実装

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ Feature [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)（Engine Capability、実装済み）

Phase2の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)の「次に作成するIssue候補」2番目）。

## 機能概要

Engine ID、表示名、Capability等のエンジン情報を一元的に登録・取得できるRegistryを実装する。

## 目的

Engine ID、表示名、Capability等のエンジン情報を一元的に登録・取得できるRegistryを実装する。

## 背景

Investigation #2・ADR-0001で、エンジン判定が`predict.py`等5箇所に分散する`if/elif`に依存している現状と、Engine Registry導入による解消方針を確認済み。Engine Capability（#4）に続き、Registryの最小基盤を実装する。

## 今回の実装範囲

- EngineDescriptor
- EngineRegistry
- register
- unregister
- get
- list
- exists
- 組み込みエンジン情報の登録（tesseract/paddleocr/easyocr/trocr）
- 単体テスト

## 対象外

- 既存if/elifの置換
- predict.pyへの適用
- job_runner.pyへの適用
- ocr_evaluation.pyへの適用
- model_registry.pyへの適用
- release_gate.pyへの適用
- TrainingHandler
- InferenceHandler
- EvaluationHandler
- MetadataProvider / ModelLoader / Exporter / Validator / Factoryによる実処理生成
- TrOCR実装
- Frontend変更

## 現在の動作

Engine Registryという概念自体が存在しない（現時点では未実装）。エンジン情報はEngine Capability（#4）としてのみ保持されている。

## 期待する動作

`src/app/services/engine_registry.py`から`EngineDescriptor`・`EngineRegistry`をimportし、既知4エンジンを登録済みの`EngineRegistry`インスタンスを`create_default_registry()`で取得できる。register/unregister/get/list/existsの5操作が動作する。既存エンジンの動作（推論・学習・評価等）には一切影響しない。

## UI変更

なし

## Backend変更

`src/app/services/engine_registry.py`を新規追加。既存ファイルの変更なし。

## API変更

なし

## データ構造・永続化への影響

なし

## Datasetへの影響

なし

## Experimentへの影響

なし

## Modelへの影響

なし

## Evaluationへの影響

なし

## Benchmarkへの影響

なし（`services/benchmark.py`は変更しない）

## セキュリティ・監査への影響

なし

## ドキュメント更新対象

- `docs/design/ENGINE_REGISTRY.md`（MVP実装済みノート追記）
- `docs/workitems/trocr/ISSUE_MAP.md` / `EPIC.md` / `README.md`（進捗反映）

## テスト観点

- EngineDescriptor/EngineRegistryの生成・登録・取得・削除・存在確認
- 異常系（重複登録・不正な型・空文字・未登録ID）
- 複数Registryインスタンス間の状態分離
- 既存テストスイート（`python -m pytest -q`）が全て通過する

## 受け入れ条件

- [x] `EngineDescriptor`（engine_id/display_name/description/version/capability/implemented）を実装している
- [x] `EngineRegistry`（register/unregister/get/list/exists）を実装している
- [x] 組み込み4エンジン（tesseract/paddleocr/easyocr/trocr）を登録できるfactory関数がある
- [x] 単体テストを追加し通過する
- [x] `docs/design/ENGINE_REGISTRY.md`へMVP実装済みである旨を追記している
- [x] 既存コード（`predict.py`等）を変更していない
- [x] 既存テストスイートに影響がない

## 補足資料

- [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)
- [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
