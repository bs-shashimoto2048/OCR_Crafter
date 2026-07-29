# ADR-0001: TrOCR統合アーキテクチャ

- **Status**: Accepted
- **Date**: 2026-07-28（Proposed）/ 2026-07-29（Accepted）
- **Related Issue**: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)
- **Related PR**: [#3](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/3)

> このADRは調査（Investigation #2）および[Design Documents](#追記2026-07-28-design-documents作成済み)のレビューを経て**Accepted**となった。本実装（Phase2以降の実装Issue）はこのADRの決定に基づいて進める。

## 追記（2026-07-28）: Design Documents作成済み

案C（Engine Capability導入 + 限定Adapter）の具体的な設計として、以下3件のDesign Documentsを作成した。

- [../design/ENGINE_CAPABILITY.md](../design/ENGINE_CAPABILITY.md) — エンジンごとの機能差異を宣言的に表現するスキーマ設計
- [../design/ENGINE_REGISTRY.md](../design/ENGINE_REGISTRY.md) — Engine Capability/各種Handler/Factoryの設計、既存コード（`predict.py`等5箇所＋Benchmark Runner）との対応表
- [../design/MODEL_METADATA.md](../design/MODEL_METADATA.md) — エンジン共通のモデル管理情報スキーマ設計

これら3設計は**TrOCR専用ではなく**、PARSeq/ABINet/ViTSTR/SVTR/Florence/Qwen-VL OCR等、将来追加されうる多様なエンジンを想定して設計している（詳細は各ドキュメントの「設計方針」参照）。

## 追記（2026-07-29）: Design Review完了・Accepted決定

上記3件のDesign Documentsのレビューが完了し、本ADRのStatusを**Proposed→Accepted**へ変更した。以降はPhase2（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)参照）の実装Issue作成・着手に進む。**ただしTrOCR本体（`trocr_pipeline.py`等）の実装はこの時点でもまだ開始しない。**

## Context

OCR Crafterは現在、Tesseract（LSTM fine-tune）・PaddleOCR（認識モデル学習）・EasyOCR（推論専用）・カスタム分類モデル（文字分割ベース）の4エンジンを扱っている。5つ目のエンジンとしてTrOCR（Microsoft/Hugging FaceのTransformerベースEnd-to-End文字認識モデル）を追加するにあたり、既存アーキテクチャへどう統合するかを決定する必要がある。

コード調査の結果、現在のエンジン振り分けは統一されたFactory/Registryを持たず、以下5箇所がそれぞれ独立した`if/elif`分岐（または類似の条件分岐）でエンジンを判定している。

1. 推論: `src/app/predict.py::predict_from_image()`
2. モデル評価: `src/app/services/ocr_evaluation.py::build_recognizer()`（現状Tesseract専用、PaddleOCR/EasyOCRは未対応）
3. 学習ジョブ振り分け: `src/app/job_runner.py` / `main.py::_spawn_training_runner`（`job_type`という別語彙で分岐）
4. モデル一覧: `src/app/services/model_registry.py::list_model_infos()`（ファイル拡張子で分岐）
5. リリースGate: `src/app/services/release_gate.py::_model_engine()`（model_registry.pyとは独立した、ファイル名拡張子だけで判定するもう1つのロジック）

唯一の例外として `src/app/services/benchmark.py` の `ENGINE_BUILDERS`/`ENGINE_CATALOG` が、辞書ベースのAdapterパターン（`builder(project_id, spec) -> {"label", "recognize"}`）としてBenchmark Runner専用に実装されている。

Frontend側も同様に、`InferenceView.jsx`・`OcrBatchView.jsx`・`RapidOCRView.jsx`の3画面がほぼ同一の「ドロップダウン＋if/else-ifチェーン」を独立して実装しており（`engine`関連の文字列比較は10ファイルで111箇所、文字列リテラルの出現は16ファイルで162箇所）、`ModelsView.jsx::engineLabelOf()`と`lib/inferenceModel.js::resolveInferenceEngine()`には「`training_family === "ocr"`かつ`engine !== "tesseract"`なら無条件に`"PaddleOCR"`とみなす」という既存のキャッチオール実装があり、新エンジンを追加すると誤表示・誤ルーティングが発生することを確認した。

また、TrOCR自体の一次資料（Hugging Face Transformers公式ドキュメント、Microsoft `unilm/trocr`リポジトリ、arXiv:2109.10282）を調査した結果、公式Microsoft学習コード（`unilm/trocr`、fairseqベース）はLinux・多GPU前提でOCR Crafterの実行環境（Windows・CPU可・オフライン運用）と適合しないこと、一方でHugging Face Transformers経由（`VisionEncoderDecoderModel`+`TrOCRProcessor`+`Seq2SeqTrainer`）であれば標準的なPyTorchモデルとして扱え、既存の`torch==2.11.0`依存と共存可能であることを確認した。

## Decision

**案C: 「Engine Capability」の導入 + 限定的なAdapter適用を採用する（Accepted）。**

要約:

- Engine Capabilityを導入する（エンジンごとの機能差異を宣言的スキーマとして表現。[ENGINE_CAPABILITY.md](../design/ENGINE_CAPABILITY.md)）
- Engine Registryを導入する（Capability/各種Handler/Factoryによる解決機構。[ENGINE_REGISTRY.md](../design/ENGINE_REGISTRY.md)）
- 共通Model Metadataを導入する（エンジン共通のモデル管理情報スキーマ。[MODEL_METADATA.md](../design/MODEL_METADATA.md)）
- TrOCRはこの共通基盤（Engine Capability / Engine Registry / Model Metadata）の上へ実装する
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR/カスタム分類）は共通基盤へ**段階的に移行する**（本ADRでは移行時期・要否を決定しない）
- 既存3エンジンの**一括リファクタリングは行わない**（既存の`if/elif`分岐は当面維持し、回帰リスクを避ける）

具体的には:

1. `services/benchmark.py`の`ENGINE_BUILDERS`/`ENGINE_CATALOG`と同型の、宣言的な「Engine Capability」情報（学習可否・評価可否・PSM/whitelist要否・チェックポイント形式等）を新設する
2. 既存3エンジン（Tesseract/PaddleOCR/custom）の`predict.py`・`ocr_evaluation.py`・学習ジョブ振り分けにある既存の`if/elif`分岐は**書き換えない**
3. TrOCR固有の学習・推論処理は、`tesseract_pipeline.py`と対になる新規モジュール`services/trocr_pipeline.py`として独立実装する
4. TrOCRの学習は、Microsoft公式`unilm/trocr`（fairseqベース）ではなく、**Hugging Face Transformers経由**（`VisionEncoderDecoderModel`+`Seq2SeqTrainer`）を採用する
5. 推論（`recognize(image_path) -> (text, confidence)`）は、Benchmark Runnerで実証済みの最小インターフェースに合わせてAdapter化し、`ENGINE_BUILDERS`スタイルの辞書へ追加登録できるようにする
6. 既存の欠陥である`ModelsView.jsx::engineLabelOf()`・`lib/inferenceModel.js::resolveInferenceEngine()`・`release_gate.py::_model_engine()`の「PaddleOCRキャッチオール」を、新設するCapability参照へ置き換えて是正する

## Options

比較した4案（詳細は[ARCHITECTURE_DRAFT.md](../workitems/trocr/ARCHITECTURE_DRAFT.md)の比較表を参照）:

- **案A**: 既存の`if/elif`分岐（5箇所）へTrOCR分岐を素直に追加する
- **案B**: 全エンジン共通の`Recognizer`Adapterへ既存3エンジンを含めて統一リファクタリングする
- **案C（採用案）**: Engine Capability導入 + 新規TrOCR専用モジュール + 推論のみ限定的にAdapter化
- **案D**: TrOCR専用Backendとして既存コードに一切触れず完全独立で追加する

## Pros

**案Cを選んだ理由:**

- 既存3エンジンの動作コード（`predict.py`等の`if/elif`本体）を書き換えないため、回帰リスクが低い
- `ENGINE_BUILDERS`という実証済みパターンを再利用でき、ゼロから設計しない（CLAUDE.mdの「既存コードを流用できる部分を優先する」に合致）
- 今回の調査で発見した既存の欠陥（エンジン判定のキャッチオール）を、新機能追加のついでではなく「Capability導入」という土台の中で正面から是正できる
- TrOCRの学習方式（Python内Transformers呼び出し）は既存エンジン（外部プロセス実行）と本質的に異なるため、専用モジュールへ切り出すことで「TrOCR固有仕様を既存エンジンへ押し付けない」というWork Item制約を満たせる
- Dataset Registry・Experiment Tracker・Benchmark Centerはいずれも現状engine非依存の設計であることを確認済みのため、これらへの変更は最小限で済む

## Cons

- 案Aほど初期実装コストは小さくない（Capabilityテーブルの設計・新規モジュールの追加が必要）
- 案Bのような完全统一と比べ、将来6つ目・7つ目のエンジンを追加する際、推論以外（学習・評価）の重複はある程度残る
- Capabilityテーブルの設計次第では、既存3エンジンにも遡って情報を整備する追加作業が発生しうる（本ADRでは既存分岐自体は変更しない方針のため、Capability情報は「新規追加分の参照用」に留め、既存3エンジンの分岐を置き換える作業は本Issueのスコープに含めない）

## Consequences

- `services/trocr_pipeline.py`（新規）、`services/benchmark.py`のCapability/Builder拡張、`ModelsView.jsx`/`lib/inferenceModel.js`/`release_gate.py`の欠陥修正、という具体的な実装Issueが後続で必要になる（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)参照）
- `requirements.txt`へ`transformers`（および必要に応じ`sentencepiece`/`accelerate`）を新規追加する必要がある（本Issueでは追加していない）
- モデル評価画面（`ocr_evaluation.py`）のTrOCR対応、および文字単位confidenceの算出方法は未解決のまま次フェーズへ持ち越す

## Compatibility

- **Dataset**: `meta.json`のスキーマ変更は不要（engine非依存の画像＋テキストペア形式のまま利用可能と判断）
- **Experiment**: 既存の`training`サブオブジェクトの`optimizer`/`scheduler`/`loss`/`learning_rate`/`batch_size`という予約済みフィールドを活用できる可能性が高いが、epoch/loss推移など新規フィールドが必要か未確定
- **Model**: 既存の`engine`フィールド駆動の`model_info`構造をそのまま利用（`.ocr.json`同様、JSON内に`"engine": "trocr"`を明示的に格納する方式を想定）
- **Benchmark**: `ENGINE_BUILDERS`/`ENGINE_CATALOG`への追加登録のみで、Benchmark Center側の変更は不要
- 既存3エンジンのAPI・保存形式・UIは本ADRの方針では変更しない

## Migration

既存データ・既存プロジェクトへの移行作業は本ADRの方針では発生しない見込み（既存エンジンの保存形式・スキーマを変更しないため）。ただし`ModelsView.jsx::engineLabelOf()`等の欠陥修正が既存のPaddleOCRモデル表示に影響しないことを、実装Issueの回帰テストで確認する必要がある。

## Future Work

Phase2以降で以下を実装Issueとして着手する（詳細・順序は[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase1参照）。

1. **Engine Capability実装** — [ENGINE_CAPABILITY.md](../design/ENGINE_CAPABILITY.md)のスキーマを`src/app/services/engine_capability.py`（新設）へ実装
2. **Engine Registry実装** — [ENGINE_REGISTRY.md](../design/ENGINE_REGISTRY.md)の`EngineDescriptor`/各種Handler Protocol/Factory/遅延登録の仕組みを実装
3. **Model Metadata実装** — [MODEL_METADATA.md](../design/MODEL_METADATA.md)の統一スキーマを実装（既存`.tess.json`/`.ocr.json`/`.pt`は変更しない）
4. **TrOCR Backend実装** — 上記共通基盤を土台に`services/trocr_pipeline.py`を新設（Hugging Face Transformers経由、[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase3以降）

その他の未解決事項:

- モデル評価（`ocr_evaluation.py`）の複数エンジン対応（TrOCR固有の課題ではなく、PaddleOCRも含む既存の積み残し）
- 日本語等、英語以外の言語対応方針の決定

## Related Issue

Investigation #2

## Related PR

[#3](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/3)（本ADRのAccepted決定を含む設計成果を追記予定。Open維持）
