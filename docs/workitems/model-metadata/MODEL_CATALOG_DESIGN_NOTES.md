# Model Catalog Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)（Model Catalog、Completed） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.9

本ドキュメントは、Model Catalog（Feature #40）実装にあたって行ったスコープ決定・将来検討事項を記録する。

## スコープ決定

### `inference_model.json`を`list()`の対象外とする

`inference_model.json`（`services/inference_model.py`）はプロジェクトルート直下に置かれる、**「現在推論に使用しているモデル」を指すポインタ**であり、モデル成果物そのものではない。既に何らかの`.ocr.json`/`.tess.json`/Canonical sidecarとして`list()`に含まれているモデルを指し示すだけの参照情報であるため、これを独立した「モデル」としてCatalogへ含めると、同じ実体を指す2つの異なるエントリ（本来のモデルファイル由来のエントリと、ポインタ由来のエントリ）が重複して現れる可能性があり、意味的に不整合となる。

本Featureでは`.ocr.json`/`.tess.json`（`models/`ディレクトリ配下のモデル成果物）のみを`list()`の対象とし、`inference_model.json`は対象外とした。

**将来検討すべきこと**: Inference連携Issue（Architecture 6.10 Resolver）で、「現在選択中のモデル」をCatalog経由でどう表現するか（`ModelCatalog`とは別のAPIとして提供する等）を判断する。

### `.pt`（分類モデル）のLegacy変換を対象外とする

Legacy Metadata Adapter（Feature #34）は`.ocr.json`/`.tess.json`/`inference_model.json`の3形式のみに対応しており、`.pt`（分類モデルのチェックポイント）に対応するAdapterが存在しない。この既存の制約をそのまま引き継ぎ、本Catalogも`.pt`ファイルをLegacyとして読み込まない。

`.pt`モデルにCanonical sidecar（`<name>.pt.model_metadata.json`）が別途書き込まれていれば、Canonical経路で通常どおり検出される（Canonical判定はエンジン非依存のため）。

**将来検討すべきこと**: `.pt`用のLegacy Adapter（例: `ClassificationMetadataAdapter`）を追加するかどうかは、Canonical ModelMetadata Schema整備（Feature #32）時点で既知の制約（`engine="custom"`がEngine Registry未登録）と合わせて、別Issueで判断する。

### Legacyのmodel_idは暫定的にファイル名を採用する

Architecture 6.3では、`model_id`は最終的に既存の`data/model_ids.json`（M0001形式の管理No登録簿、`model_registry.py::assign_model_ids()`）を再利用する方針が決定されている。しかし本Featureでは、Catalogから`model_registry.py`（既存の本番モデル管理コード）へ新たに依存を持ち込むことを避け、Reader/Writer/Adapterと同様に「既存コードへ未配線のまま」という状態を維持するため、Legacyファイルのmodel_idには**暫定的にファイル自身の名前**（例: `digits_20260101.tess.json`）を採用した。

Canonicalエントリについては、sidecar内に既に`model_id`が埋め込まれているため、そのまま採用する（Writerが書き込んだ時点でどのような値が使われたかに委ねる）。

**将来検討すべきこと**: `data/model_ids.json`との統合（Legacyファイルにも正式なM0001形式のmodel_idを付与する）を、Models連携Issue（Architecture 10章）またはそれ以前の専用Issueで判断する。

## 例外設計の確定（Architecture 6.9の元の記述を修正）

Architecture 6.9の元の記述には「invalid metadata除外」という一文があったが、本Featureでは**採用しなかった**。Reader/Adapter由来の例外（`MetadataReadError`/`InvalidModelMetadataError`/`UnsupportedLegacyMetadataError`）は、Catalogが握りつぶさずそのまま呼び出し側へ伝播させる。`ModelCatalogError`はディレクトリ探索エラー（対象ディレクトリが存在しない・権限無し・`load()`の対象未検出）のみを表す。

**理由**: 破損ファイル・Validation違反を静かに除外すると、実際にはデータ品質問題が発生しているにもかかわらず`list()`の結果からは何も分からなくなる。呼び出し側（将来のModels API連携等）が、エラーを検知した上でどう扱うか（ユーザーへ警告表示する、当該モデルを除外して他を表示する等）を判断できるよう、例外はそのまま伝播させる設計とした。

**将来検討すべきこと**: 実際にModels API連携（Architecture 10章）を実装する段階で、「1件の破損ファイルが`list()`全体を失敗させてよいか」を再検討する。必要であれば、Catalogに「安全に除外して警告ログを残すモード」をオプションとして追加することも考えられるが、今回は選択肢を広げず、シンプルな伝播のみとした。

## PR #41マージ前レビューで挙がったMinor（未対応・将来検討事項）

PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)のマージ前レビュー（Approve推奨）で、以下2件のMinorが指摘された。いずれもBlocker/Majorではなく、本Feature内では対応していない。

1. **ADR-0002の「フィルタ」表現の不整合**: [ADR-0002](../../adr/ADR-0002_Unified_Model_Metadata.md)「Decision」節の要約箇条書きに、`ModelCatalog`の責務として「一覧・フィルタ・重複排除」という記述が残っているが、Architecture 6.9の「実装確定」注記が明記するとおり、本Featureではエンジン等によるフィルタ機能は実装していない（`list()`は無条件の全件列挙のみ）。ADR-0002側の「フィルタ」の語を実装に合わせて修正するかどうかは未対応。
2. **model_id衝突（Cross-file）のテスト欠如**: Canonicalエントリの`model_id`が、別ファイル由来のLegacyエントリの`model_id`（ファイル名）と偶然一致するケースについて、Canonical優先で正しく1件に重複排除されることをレビュー時に直接実行して確認済みだが、これを固定するリグレッションテストは未追加。

**将来検討すべきこと**: 次のFeature Issue着手時、または旧管理方式Cleanup前の棚卸しのタイミングで、上記2件の対応要否を判断する。

## 対象外

- 本ドキュメントの記述に基づくコード変更（将来のIssueで判断する）
- Model Catalog（Feature #40）自体の修正
