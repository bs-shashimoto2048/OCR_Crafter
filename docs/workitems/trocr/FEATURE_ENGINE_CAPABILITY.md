# [Feature] Engine Capability実装

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)（設計完了）/ [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)

Phase2の最初の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)の「次に作成するIssue候補」1番目）。

## 機能概要

OCR Engine Platformの共通基盤として、エンジンごとの機能差異を宣言的に保持する「Engine Capability」の型・データを実装する。今回は「Capabilityを保持できる」ところまでを実装する。

## 背景

Investigation #2の結果、OCR Crafterのエンジン振り分けは統一されたFactory/Registryを持たず、5箇所の独立した`if/elif`分岐に分散していることが判明した。ADR-0001（Accepted）でCapability導入を含む「案C」を採用方針として決定し、[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)でスキーマ設計を完了済み。

## 解決したい問題

エンジンの能力差異（学習可否・推論方式・評価対応・Export可否・Hardware要件・言語対応等）を表現する共通の型が存在しない。新エンジン追加のたびにコード各所へ個別知識を埋め込む必要がある。

## 目的

`docs/design/ENGINE_CAPABILITY.md`のスキーマをPythonの型付き実装へ落とし込み、既存4エンジン（Tesseract/PaddleOCR/EasyOCR）+TrOCRのCapabilityデータを保持できるようにする。

## 対象範囲

- `src/app/services/engine_capability.py`（新規）: `EngineCapability` dataclass、既知Engine ID定数、シリアライズ/デシリアライズ関数
- 既存4エンジン中3種（tesseract/paddleocr/easyocr）+ TrOCR（trocr、未実装だがCapabilityのみ定義）のCapabilityインスタンス
- 単体テスト（生成/シリアライズ/デシリアライズ/比較/コピー）

## 対象外

- Engine Registry実装（別Issue）
- TrOCR本体の実装（`trocr_pipeline.py`等）
- 既存`predict.py`等の`if/elif`分岐の置き換え・削除
- 既存コードからのCapability参照・呼び出し（今回は型を定義するのみで、配線しない）

## 現在の動作

Engine Capabilityという概念自体が存在しない（現時点では未実装）。近い概念として`services/benchmark.py`の`ENGINE_CATALOG`（`key`/`label`/`implemented`/`requires_model`/`profile_keys`のみ）が存在するが、本Issueでは変更しない。

## 期待する動作

`src/app/services/engine_capability.py`から`EngineCapability`型と、tesseract/paddleocr/easyocr/trocrそれぞれのCapabilityインスタンスをimportして利用できる。辞書との相互変換（`to_dict`/`from_dict`）、比較、コピーができる。既存エンジンの動作（推論・学習・評価等）には一切影響しない。

## UI変更

なし

## Backend変更

`src/app/services/engine_capability.py`を新規追加。既存ファイルの変更なし。

## API変更

なし

## データ構造・永続化への影響

なし（新規モジュールの追加のみ。`config/settings.yaml`・`data/projects/`配下のファイル形式は変更しない）

## Datasetへの影響

なし

## Experimentへの影響

なし

## Modelへの影響

なし（既存モデルファイル・メタデータ形式は変更しない）

## Evaluationへの影響

なし

## Benchmarkへの影響

なし（`services/benchmark.py`は変更しない）

## セキュリティ・監査への影響

なし

## ドキュメント更新対象

- `docs/design/ENGINE_CAPABILITY.md`（「実装済み」を追記）
- `docs/workitems/trocr/README.md`（進捗反映）
- 本Issue（進捗反映）

## テスト観点

- `EngineCapability`インスタンスを生成できる
- 辞書へシリアライズ（`to_dict`）し、同じ内容で復元（`from_dict`）できる
- 同じ内容のインスタンス同士は等価、異なる内容は非等価と判定できる
- インスタンスのコピー（一部フィールドを変更したコピーを含む）ができる
- 既存テストスイート（`python -m pytest -q`）が全て通過する（既存エンジンへの影響がないことの確認）

## 受け入れ条件

- [ ] `EngineCapability`クラスを実装している
- [ ] 型ヒントを全フィールドに付与している
- [ ] Engine ID（tesseract/paddleocr/easyocr/trocr）を定義している
- [ ] 単体テストを追加し通過する
- [ ] `docs/design/ENGINE_CAPABILITY.md`へ実装済みである旨を追記している
- [ ] Build（フロントエンド）・既存テストスイートに影響がない
- [ ] 既存コード（`predict.py`等）を変更していない

## 補足資料

- [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)
- [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
