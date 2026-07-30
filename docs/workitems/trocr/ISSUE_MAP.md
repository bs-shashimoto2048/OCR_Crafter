# TrOCR対応 Issue Map

Related Issue: Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)

## 現在作成するIssue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) Transformer OCR対応基盤とTrOCR統合
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）
- Feature: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4) Engine Capability実装（実装済み。Parent Epic: #1）
- Feature: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9) Engine Registry実装（MVP実装済み・PR未マージ。Parent Epic: #1）

## 次に作成するIssue候補（確定順序、2026-07-29）

ADR-0001がAcceptedとなり、Phase2（共通基盤実装）へ移行するにあたり、次に作成するIssue候補の順序を以下のとおり確定した。**GitHub Issueはまだ作成しない。** 各項目の詳細は次節「調査完了後に作成を検討するIssue（Phase構成）」の該当Phaseを参照。

1. **Engine Capability** — Phase1（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)の実装、✅完了: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）
2. **Engine Registry** — Phase1（[ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)のMVP実装、✅実装済み・PRレビュー待ち: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)）
3. **Model Metadata** — Phase1（[MODEL_METADATA.md](../../design/MODEL_METADATA.md)の実装）
4. **Engine判定既存バグ修正** — Phase2（`engineLabelOf()`/`resolveInferenceEngine()`/`_model_engine()`のキャッチオール是正＋判定ロジックの一本化）
5. **TrOCR Backend** — Phase3（依存関係・設定管理・Dataset確認・TrOCR Model Metadata適用）
6. **TrOCR Training** — Phase4（`services/trocr_pipeline.py`学習Backend）
7. **TrOCR Inference** — Phase4（推論Backend、`ENGINE_BUILDERS`スタイルの`recognize()`実装）
8. **TrOCR Evaluation** — Phase4（評価連携の方針決定・confidence算出方法の確定）
9. **Frontend** — Phase5（Model Manager UI / Training UI / Evaluation UI / Experiment Tracking連携）
10. **Benchmark** — Phase6（Benchmark Runner/Center連携）
11. **Documentation** — Phase7（Backend/Frontendテスト・マニュアル・チュートリアル・リリース確認）

1〜3（Engine Capability/Engine Registry/Model Metadata）は、TrOCRの採否に関わらず単独で価値を持つ共通基盤であるため最優先で着手する。4は新機能ではなく既存バグ修正のため3の直後に行う。5以降がTrOCRという最初の適用事例になる。

## 調査完了後に作成を検討するIssue（Phase構成）

以下は[ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)・[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)（案C: Engine Capability + 限定Adapter）・`docs/design/`配下のDesign Documentsの内容を反映した仮の分割案であり、**まだGitHub Issueを作成しない**（ユーザーレビュー後に作成する）。

**設計方針**: Phase1〜2は「今後どんなOCRエンジンを追加しても再利用できる共通基盤」、Phase3〜6が「TrOCRという最初の適用事例」、Phase7が両方に関わるドキュメントである。TrOCR固有の実装（Phase3〜6）と共通基盤（Phase1〜2）を明確に分離し、Phase1〜2はTrOCRが最終的に不採用になった場合でも単独で価値を持つ（次にPARSeq等を検討する際にそのまま使える）よう設計している。

### Phase1: 共通基盤（Engine Capability / Engine Registry / Model Metadata）

- **Engine Capability**（✅完了: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）: [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)の設計を実装。`src/app/services/engine_capability.py`へスキーマ定義（既存3エンジンの`if/elif`分岐は変更しない。既存コードからの参照・配線はEngine Registry実装後に行う）
- **Engine Registry**（✅MVP実装済み: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)）: [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)のうち`EngineDescriptor`/`EngineRegistry`（register/unregister/get/list/exists）のみを実装。Training/Inference/Evaluation Handler・MetadataProvider・ModelLoader・Exporter・Validatorは未実装（別Issue）。既存3エンジンをRegistryへ移行するかは別Issue、本Phaseでは仕組みのみ
- **Model Metadata**: [MODEL_METADATA.md](../../design/MODEL_METADATA.md)の統一スキーマを実装（既存`.tess.json`/`.ocr.json`/`.pt`は変更しない。新規エンジン向けの標準形式として新設）

### Phase2: 既存バグ修正・Engine判定の一本化

- **既存エンジン判定の欠陥修正**（新機能ではなくバグ修正）: `frontend/src/views/ModelsView.jsx::engineLabelOf()`・`frontend/src/lib/inferenceModel.js::resolveInferenceEngine()`・`src/app/services/release_gate.py::_model_engine()`の「PaddleOCRキャッチオール」をEngine Capability参照へ置き換えて是正（TrOCR追加前から存在する潜在バグの是正であり、既存3エンジンの表示が壊れないことを回帰テストで確認する）
- **Engine判定の一本化**: `release_gate.py::_model_engine()`と`model_registry.py`の重複した拡張子判定ロジックを、Engine Registryの解決方法（[ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)の「Engine解決方法」参照）へ一本化

### Phase3: TrOCR Backend基盤

- **TrOCR依存関係・設定管理**: `requirements.txt`へ`transformers`等を追加、`config/settings.yaml`へ新設の統一名前空間（例: `engines.trocr.*`）でブロック新設、遅延import方針の適用
- **TrOCR Dataset側の確認**: 既存Dataset形式（`meta.json`）がそのまま使えることを実装レベルで検証（スキーマ変更は不要と調査時点で判断済み）
- **TrOCR Model Metadata**: [MODEL_METADATA.md](../../design/MODEL_METADATA.md)スキーマに沿ったTrOCR用メタデータ実装（`processor`/`tokenizer`/`license`等の新規フィールドを実際に使う最初の事例）

### Phase4: Training / Inference / Evaluation

- **TrOCR学習Backend**: `services/trocr_pipeline.py`新設。Hugging Face Transformers（`VisionEncoderDecoderModel`+`Seq2SeqTrainer`）経由、公式`unilm/trocr`（fairseq）は不採用（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)決定事項）
- **TrOCR推論Backend**: `predict.py`への`trocr`分岐追加、および`ENGINE_BUILDERS`スタイルの`recognize()`実装（[ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)の`InferenceHandler`参照）
- **TrOCR評価連携の方針決定**: `ocr_evaluation.py`のTesseract専用制約への対応可否（PaddleOCRも未対応のため、TrOCR単独の課題ではないことに留意）。confidence算出方法の確定（未解決事項）

### Phase5: Frontend

- **Model Manager UI**: Engine Capability参照への切替（Phase2の欠陥修正と連動）
- **Training UI**: `TrainingView.jsx`の既存ドロップダウンへTrOCR選択肢を追加
- **Evaluation UI**: Phase4の評価連携方針決定に連動
- **Experiment Tracking連携**: 既存の`training`サブオブジェクト予約フィールド（`optimizer`/`scheduler`/`loss`/`learning_rate`/`batch_size`）の活用可否、epoch/loss推移の記録要否を確定

### Phase6: Benchmark

- **Benchmark Runner連携**: `ENGINE_CATALOG`/`ENGINE_BUILDERS`へのTrOCR登録
- **Benchmark Center連携**: 変更不要の想定だが実装後に確認（調査時点でengine非依存と判断済み）

### Phase7: Documentation

- **Backendテスト**: `trocr_pipeline.py`の単体テスト、既存3エンジン（Tesseract/PaddleOCR/カスタム分類）への回帰テスト
- **Frontendテスト**: `engineLabelOf()`等の修正に対する回帰テスト（既存PaddleOCR表示が壊れていないことを含む）
- **ユーザーマニュアル**: `docs/manual/`関連章の更新
- **チュートリアル**: `docs/tutorial/`へTrOCRチュートリアル追加（日本語対応方針が未解決のため、英語/英数字ユースケースを優先する可能性あり）
- **リリース・移行確認**: 既存プロジェクトへの影響が無いことの最終確認

## その他の将来検討候補（優先度低・Epic対象外）

- **[Performance] Frontendの初期JavaScript bundleを分割する**: `npm run build`時に`index-*.js`が500kBを超える警告が継続的に出ている（2026-07-29時点で約937kB）。ビルド自体は正常完了しており、Engine Capability/Engine Registry実装（Backendのみの変更）とは無関係。現時点では初期表示遅延等の具体的な症状は確認できていないため、急いで対応する必要はない。実際に初期表示が遅い・端末で重い・配信環境で問題になる等の症状が確認された段階でIssue化し、対応を検討する

## 分割ルール

- 1 Issue = 1つの明確な完了条件
- 調査と実装を同じIssueへ混在させない
- BackendとFrontendを無条件に同一Issueへまとめない
- 共通基盤とTrOCR固有処理を区別する
- ドキュメントを最後の巨大Issueへまとめすぎない
- 既存機能の変更は回帰テストを含める
