# ADR-0002: Unified Model Metadataと段階的Migration方式

- **Status**: Accepted
- **Date**: 2026-07-31（Proposed）/ 2026-07-31（Accepted）
- **Related Issue**: Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)（Completed・Closed） / Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)（Closed） / Parent Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)
- **Related PR**: [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)（Squash Merge済み。Squash Commit: `ce04863`）

> このADRはArchitecture Issue #30の成果物であり、Investigation #29の調査結果を前提とする。PR #31のレビュー承認・mainへのSquash Mergeを受けて、本ADRのStatusを**Proposed→Accepted**へ変更した。以降、本ADRの決定は正式な設計判断として扱い、Epic #28配下のFeature Issue（Canonical ModelMetadata Schema整備以降）はこの決定に基づいて進める。
>
> **実装状況（2026-07-31）**: Feature [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)（Canonical ModelMetadata Schema）**Completed**。PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)をSquash Merge・mainへ反映済み（Merge Commit: `b250c8f`）。本ADRの「Canonical Schema」決定（既存`ModelMetadata`採用・`schema_version`はenvelope値としてdataclass外で扱う）を実装済み。
>
> **Legacy Metadata Adapter: Completed**。Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)により、PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)をSquash Merge・mainへ反映済み（Merge Commit: `434993d`）。本ADRの「Adapter」決定（単一`LegacyMetadataAdapter`＋専用Adapter分離、Factory/Registry/Plugin/DIは導入しない）を実装済み。
>
> **Metadata Reader: Completed**。Feature [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)により、`MetadataReader`（`read_canonical()`/`read_legacy()`/`read()`）を実装。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)をSquash Merge・mainへ反映済み（Merge Commit: `678524f`）。[METADATA_READER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_READER_DESIGN_NOTES.md)の未決事項（`inference_model_id`優先順位・`source`のtraining/backfill区別）を決定・実装済み。
>
> **Metadata Writer: Completed**。Feature [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)により、`MetadataWriter.write(path, metadata)`を実装（`atomic_write_json`+`file_lock`を再利用した単純な上書き保存のみ、既存sidecarの読み取り込みマージは対象外）。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)をSquash Merge・mainへ反映済み（Merge Commit: `5b1564c`）。I/Oエラーは新設`MetadataWriteError`。`ModelMetadata.extra`のJSON直列化可能性に関する将来検討事項は[METADATA_WRITER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_WRITER_DESIGN_NOTES.md)参照。Catalog以降は未実装（次はModel Catalog）。

## Context

Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合）の実装過程で、Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)により`ModelMetadata` dataclass（`src/app/services/model_metadata.py`）を実装したが、既存コードへは一切配線されていないことが確認された（Feature #25レビュー時に確定、[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)の【最優先】Future Work参照）。

Investigation #29でこの状況を詳細調査した結果、モデルに関する情報は単一のSource of Truthではなく、最低限以下の独立した永続化機構に分散していることが判明した（詳細は[MODEL_METADATA_MIGRATION_PLAN.md](../design/MODEL_METADATA_MIGRATION_PLAN.md)）。

- モデル別メタデータファイル（`.ocr.json`/`.tess.json`/`.pt`）
- 推論使用モデル選択（`inference_model.json`）
- Release状態レジストリ（`releases.json`）
- 実験カルテ（`experiments.json`）
- モデル管理No登録簿（`data/model_ids.json`、M0001形式）
- Frontend localStorage（評価履歴・エイリアス）

加えて、Engine判定ロジックが`model_registry.py`（`resolve_engine_id()`経由）と`release_gate.py::_model_engine()`（ファイル名拡張子の独自判定）の2箇所に重複しており、後者は`custom`（分類モデル）・TrOCRを判定できない。

一括でこれらすべてを`ModelMetadata`へ統合するMigrationは、既存プロジェクトの後方互換（CLAUDE.mdの絶対制約）を壊すリスクが高い。段階的な移行方式と、各コンポーネントの責務分担を確定する必要がある。

## Decision

**既存の`ModelMetadata` dataclass（Feature #14）をCanonical Schemaとしてそのまま採用し、Legacy Adapterによる段階的Migrationを行う。**

要約:

- **Canonical Schema**: 既存`ModelMetadata`を破棄せず採用。`status`/`schema_version`はdataclassへ追加しない（3つ目の状態機械を持ち込まないため。既存設計判断を維持）
- **保存形式**: モデルディレクトリ横のsidecar JSON（`<モデルファイル名>.model_metadata.json`）。`services/atomic_io.py`の`atomic_write_json`/`file_lock`を再利用する
- **model_id**: 新規のUUID等は発行せず、既存のモデル管理No登録簿（`model_registry.py::assign_model_ids()`/`data/model_ids.json`のM0001形式）をそのまま再利用する
- **engine_id**: `resolve_engine_id()`（Engine Registry）へ一本化する。`custom`（分類モデル）をEngine Registryへ新規登録する（後続Issueで実装）。`release_gate.py::_model_engine()`の独自判定は最終的にCleanupで置き換える
- **Adapter**: 形式別クラス分割はせず、単一`LegacyMetadataAdapter`（内部は形式別の変換関数）とする
- **Reader/Writer**: 渡された1ファイル（Canonicalまたは Legacy）のみを読むReader（Directory探索・Fallback探索は行わない。「無ければLegacyへ」の判定はModel Catalogの責務）、新規モデルのみへ書き込むWriter
- **Model Catalog**: 一覧・フィルタ・重複排除を担う`ModelCatalog`（Engine Registryとは別責務）
- **Resolver**: `model_id→ModelMetadata→model_ref`の解決を新設するが、**既存`POST /predict`の`model`パラメータ契約は変更しない**
- **Factory**: 単一`ModelMetadataFactory`（Engine別クラス分割なし）
- **Migration**: Phase 1（Adapter導入・既存ファイル不変）→Phase 2（新規モデルのみ書込）→Phase 3（Models→Inference→Evaluation→Deployment/Export→Release Gateの順でConsumer切替、1 Issue = 1 Consumer）→Phase 4（Cleanup）
- **後方互換**: 読めないモデルを別Engineへ推測フォールバックしない。安全に除外し、診断可能にする
- **既存モデルの一括変換・DB Migrationは行わない**

詳細な設計・各コンポーネントの責務・後方互換ケース一覧・セキュリティ設計は[MODEL_METADATA_ARCHITECTURE.md](../design/MODEL_METADATA_ARCHITECTURE.md)を参照。

## Alternatives Considered

1. **一括Migration**（全既存モデルファイルを即座に`ModelMetadata`形式へ変換）
   - 却下理由: 既存プロジェクトの後方互換を壊すリスクが高い（CLAUDE.mdの絶対制約）。ロールバックが困難
2. **DBへ全面移行**（モデルメタデータをSQLiteテーブル化）
   - 却下理由: 現行`db.py`は`training_jobs`（ジョブ実行状態）専用であり、モデル成果物はファイルベースの設計思想と一貫しない。DB Migrationのリスク・複雑性に見合うメリットが今回のScopeでは確認できない
3. **現状維持**（`ModelMetadata`を配線しないまま個別Consumer対応を続ける）
   - 却下理由: Engine判定重複・Frontend「登録済みモデルから選択」の恒久的な0件問題（Feature #25で確認済み）が解決されないまま、6つ目以降のエンジン追加のたびに同種の重複が増える
4. **Engine別Schemaを維持**（統一Schemaを作らず、Engineごとに個別の型を持たせる）
   - 却下理由: 既に`ModelMetadata`という統一Schemaが実装済みであり、これを活かさず再度Engine別型を作ることはFeature #14の実装を無駄にする
5. **Adapterによる段階移行（採用案）**
   - 既存ファイル形式を変更せず、読み取り専用のAdapter層を挟むことで、既存プロジェクトへの影響なく段階的に移行できる

## Consequences

**Positive:**

- Model MetadataがSingle Source of Truthとなり、Consumer間（Models/Inference/Evaluation/Deployment/Export）で一貫した情報を参照できる
- Engine判定が`resolve_engine_id()`へ一本化され、新規エンジン追加時の重複実装が減る
- 既存モデル・既存API・既存UIへの影響なく段階的に移行できる
- `data/model_ids.json`という既に確立された管理No機構を再利用するため、新しい識別子体系を持ち込む混乱がない

**Negative:**

- 一時的に旧形式（Legacy）とCanonical形式が併存する期間が生じる（Phase 2〜4）
- `LegacyMetadataAdapter`の保守（旧形式が増える・変わるたびに追従が必要）
- duplicate・conflict解決ロジックが必要（Catalogでの重複排除）
- Cleanup（Phase 4）まで、2つの読み取り経路（Canonical/Legacy）が残るため一定の複雑性が残る
- `model_id`（M0001登録簿）のrename/move追跡という既存の制約は今回も解決されない（Future Work）

## Rollback

- Canonical Metadata書込（Writer）を停止すれば、Phase 2以降でもすべてのConsumerはLegacy Adapter経由の読み取りへ自然に戻る（Model Catalogが「Canonical sidecarが無ければLegacyファイルをReaderで読む」という選択を行うため。Reader自体は1ファイルの読込のみでfallback判定は持たない、[MODEL_METADATA_ARCHITECTURE.md](../design/MODEL_METADATA_ARCHITECTURE.md) 6.7・8章）
- 旧ファイル（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`等）は一切削除しない方針のため、Rollback時にデータ欠損は発生しない
- Consumer単位で切り戻せる（Phase 3が「1 Issue = 1 Consumer」の設計のため、特定のConsumerだけを旧実装へ戻すことが可能）

## Compatibility

- **既存モデルファイル**: 変更・書き換えなし（読み取り専用Adapter経由）
- **既存API**: `POST /predict`・`GET /models/info`等の契約は変更しない（レスポンス形式維持）
- **既存DB**: `training_jobs`テーブルへの変更なし
- **既存localStorage**: `ocr_model_aliases_by_project_v1`・`ocr_model_eval_history_by_project_v1`のキー・形式は変更しない（統合するかどうかは後続Issueで個別判断）
- **既存プロジェクト構成**: `data/projects/<id>/models/`配下へsidecarファイルを追加するのみ（既存ファイルの位置・形式は変更しない）

## Migration

[MODEL_METADATA_ARCHITECTURE.md](../design/MODEL_METADATA_ARCHITECTURE.md)7章「Migration戦略」を参照。Phase 1〜4・Issue分割（10章）・Rollback方針は本ADRの決定に基づく。

## Future Work

- `model_id`の真の安定識別子化（rename/move追跡）
- Frontend localStorage（評価履歴・alias）のBackend連携要否の最終判断
- `ModelCatalog`のキャッシュ実装
- `release_gate.py::_model_engine()`の`resolve_engine_id()`への置き換え（Cleanup Issue）
- checksumによるmetadata整合性検証

## Related Issue

Architecture #30（Completed・Closed） / Investigation #29（Closed） / Parent Epic #28

## Related PR

[#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)（Squash Merge済み。Squash Commit: `ce04863`）
