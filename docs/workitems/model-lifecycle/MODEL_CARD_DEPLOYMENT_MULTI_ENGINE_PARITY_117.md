# Model Card / Deployment Package Multi-engine Parity 作業記録

Related: Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115)（OCR Crafter Next Development Roadmap） / Feature [#117](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/117) / Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108) / Feature [#110](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/110)（TrOCR Legacy Metadata Adapter Compatibility） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open・保留継続） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR Lifecycle、Completed）

**状態**: Completed / Closed。PR [#118](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/118)、Squash Commit `af830bf`でマージ済み。

## 目的

Investigation #115の最優先推奨テーマ（Theme 1）を実装する。Tesseract向けの前提を残したままだったModel Card / Deployment Packageを、PaddleOCR/TrOCRでも正しく機能するよう最小限のparityを実現する。Epic #28のCanonical Metadata Consumer Migrationは引き続き保留する。

## 実装前調査（Mandatory Investigation）

### 1. Model Card Call Graph

- 生成元: `release_manager.py::build_model_card(project_id, model=None)`
- 取得API: `GET /api/releases/model_card`（`main.py`）
- DB/sidecar参照先: `_load_model_meta()`が`paths.models / model`（`.tess.json`/`.ocr.json`/`.trocr.json`）を直接読み込む。DBは参照しない
- Evaluation情報の取得経路: `_experiment_for_model()`（`experiment_tracker.py::list_experiments()`をmodel名で絞り込み、その`evaluation`/`evaluation_profile`を使用）。**engineに依存しない共通経路**（実験カルテはengine横断で同じ形式のため）
- 従来のengine判定: **無かった**（`meta.get("engine")`を一切参照せず、常にTesseract前提の文言を出力していた。これが本Issueの中心的な不具合）
- Frontend consumer: `ReleasesView.jsx`（`loadModelCard()`が`markdown`をそのまま表示。Markdownの内容には一切依存しない=Frontend側の変更は不要と判明）

### 2. Deployment Package Call Graph

- 生成entrypoint: `release_manager.py::build_deployment_package(project_id)`
- 含めるartifact: 設定JSON（`meta`全体）/ モデル実体 / 前処理Snapshot / Release Note / Model Card
- 従来のモデル実体解決: `meta.get("traineddata_path")`（Tesseract専用フィールド）のみを見ていたため、**PaddleOCR/TrOCRのモデル実体は一切含まれていなかった**（これが本Issueのもう1つの中心的な不具合）
- manifest: 専用manifestファイルは無く、`model_config.json`が`meta`の生payload（`engine`フィールドを含む）をそのまま書き出す。これはengine変更不要でengine identityを含められることを意味する
- download/export API: `GET /api/releases/deployment_package`（`main.py`。`_enforce_role(request, "deployment_export")`・監査ログ記録あり、いずれも変更不要）
- Frontend consumer: `ReleasesView.jsx`のダウンロードリンク（ZIPの中身に依存しない、変更不要）
- Release Gateとの関係: 独立（Release Gateは`evaluate_release_gate()`でPolicy判定のみ行い、Model Card/Deployment Packageのビルドには関与しない）

### 3. Engine Matrix

| Capability | Tesseract | PaddleOCR | EasyOCR | TrOCR |
|---|---|---|---|---|
| Model Card | 対応済み（既存） | **今回対応**（従来はTesseract文言が誤表示） | **unsupported**（学習・登録経路自体が無い） | **今回対応**（従来はTesseract文言が誤表示） |
| Evaluation linkage | 対応済み（`_experiment_for_model()`、engine非依存） | 対応済み（同上、変更不要と確認） | unsupported | 対応済み（同上、変更不要と確認） |
| Benchmark linkage | **未実装**（Model Cardは元々どのengineでもBenchmark結果を表示しない） | 未実装（同上、全engine共通で不在のためparity gapではないと判断） | unsupported | 未実装（同上） |
| Release linkage | 対応済み（`registry["history"]`をmodel名で絞り込み、engine非依存） | 対応済み（同上、変更不要と確認） | unsupported | 対応済み（同上、変更不要と確認） |
| Deployment package | 対応済み（既存、traineddata単一ファイル） | **今回対応**（従来はモデル実体が一切含まれなかった） | unsupported | **今回対応**（従来はモデル実体が一切含まれなかった） |
| Artifact resolution | `traineddata_path`（単一ファイル） | `inference_dir`優先・無ければ`model_dir`（ディレクトリ一式） | unsupported | `model_dir`（ディレクトリ一式、train/infer分離が無い） |
| UI visibility | 対応済み（既存UIはMarkdown/ZIPの中身に依存しないため無変更で対応） | 対応済み（同上） | N/A（Production到達不可のためUIに現れない） | 対応済み（同上） |

**「unsupported」と「未実装」の区別**:
- EasyOCRは「unsupported」。学習・モデル登録経路自体が存在せず（`main.py`にEasyOCR学習エンドポイントが無い）、`list_releases()`が`.tess.json`/`.ocr.json`/`.trocr.json`のみをglobするため、EasyOCRモデルは構造的にProductionへ到達し得ない。これは本Issueで新たに実装すべき対象ではなく、既存アーキテクチャ上の正しい制約である（テストで契約を固定した、§Tests参照）
- Benchmark linkageは「未実装」だが、**全engineで等しく未実装**（Tesseractも含め、Model Cardは元々Benchmark結果を一切表示しない）。したがってengine間の不平等（parity gap）ではなく、Model Card機能そのものの拡張余地として切り分け、本Issueでは実装しない（§Explicit Non-goals「Evaluation/Benchmark architecture統合」に抵触するリスクを避けるため。Future Workとして記録）

### 4. Contract Differences

- `.tess.json`: `traineddata_path`（単一ファイル）・`tessdata_dir`/`model_dir`（同一ディレクトリ）・`base_lang`・`charset`・`max_iterations`（すべてトップレベル）
- `.ocr.json`（PaddleOCR、`ocr_pipeline.py::_register_ocr_model()`実装確認済み）: `model_dir`/`inference_dir`/`checkpoint_dir`（train/infer分離あり、ディレクトリ一式）・`charset`（トップレベル、Tesseractと同名で存在）・`training_params.epochs`/`training_params.init_source_type`/`training_params.init_source_value`（ネスト、`base_lang`相当のフィールドは存在しない）
- `.trocr.json`（TrOCR、`trocr_model_registry.py::register_trocr_model()`実装確認済み）: `model_dir`（Hugging Face `save_pretrained()`出力、train/infer分離が無くこれ1つのみ）・`base_model_ref`（`base_lang`に相当する概念だが別名）・`epochs`（トップレベル、ネストなし）・charset相当のフィールドは存在しない（文字集合を限定しない設計）
- TrOCR directory artifact: `model_dir`配下に`config.json`/`model.safetensors`（または`pytorch_model.bin`）等複数ファイルが存在する。単一ファイルへの変換は行わず、ディレクトリ構造をそのままZIPへ複製する方針とした
- EasyOCR: 学習不可（上流ライブラリの制約、既存`10_KNOWN_LIMITATIONS.md`記載どおり）。したがって「official/non-trainable」という区別はそもそも生じない（学習済みの言語モデルを直接利用する推論専用エンジンであり、本アプリのRelease/Model Card/Deployment Packageの対象体系に含まれない）
- PaddleOCR official/custom: Model Card/Deployment Packageの対象は「登録済み（`.ocr.json`が存在する）custom学習モデル」のみ（official学習前モデルは登録されないため対象外。Benchmark/Evaluationの「official」概念とは異なる文脈）

## Design Decisions

1. **engine識別は`meta.get("engine")`を正本とする**: `.tess.json`/`.ocr.json`/`.trocr.json`いずれも登録時に`engine`フィールドを保存済みであることを確認した（既存の3つの登録関数のソースを直接確認）。欠損時のみ、既存の`release_gate.py::_model_engine()`と同じsidecarファイル名suffix規約を`release_manager.py`内へ複製した（`_resolve_engine()`。クロスモジュールでprivate関数を直接importする設計を避け、同一の既存契約を踏襲する形にした）
2. **Engine表示名はEngine Registry（`engine_registry.py`）の`display_name`をそのまま使う**: Model Card独自の表示名マッピングを新設しない（Implementation Principle #3）
3. **Tesseractの出力文言は1バイトも変えない**: `_model_card_summary_line()`/`_model_card_charset_label()`/`_model_card_base_and_volume_line()`/`_model_card_known_limitations_lines()`はいずれも`engine == "tesseract"`分岐で既存コードと完全に同じ文字列を生成する（既存テスト`test_model_card`/`test_deployment_package`が無変更で全件パスすることで確認済み）
4. **TrOCRのcharsetは「未記録」ではなく「対象外」と明示する**: TrOCRは文字集合を限定しない設計上の欠如であり、データの記録漏れ（未記録）とは異なる概念であるため区別した
5. **「既知の制約」セクションもengineごとに書き換えた**: 実装中に、既存の固定文言（Whitelist・PSM・k/l/t筆記体case-sensitive）がTesseract固有の主張であり、PaddleOCR/TrOCRに適用すると事実と異なることを発見した（テスト作成中に`assert "PSM" not in md`が失敗して判明）。「用途」行と同じ問題であったため、同じ設計方針（tesseract分岐は既存文言を完全維持・他engineはengine相応の文言）で修正した
6. **Deployment Packageのdirectory artifact走査**: `_add_directory_artifact_to_zip()`を新設。PaddleOCRは`inference_dir`優先・無ければ`model_dir`（既存`legacy_metadata_adapter.py::OCRMetadataAdapter._build_canonical()`と同じ優先順位を踏襲、新しい解決層を追加しない）。TrOCRは`model_dir`のみ（train/infer分離が無いため）。ディレクトリ配下を`rglob("*")`で再帰的に走査し、相対パスを保ったまま`model/`以下へ書き込む
7. **model_config.json（既存の設定JSON）はmanifestとして追加変更しない**: `meta`をそのまま書き出す既存実装が、すでに`engine`フィールドを含んでいるため、「package manifest/metadataに正しいengine identityを含める」という受け入れ条件を無変更で満たしていた
8. **Benchmark linkageはModel Cardへ追加しない**: 全engine共通で元々未実装であり、engine間の不平等ではないため、本Issueのparity修正の対象外と判断した（§Engine Matrix参照）。追加実装はEvaluation/Benchmark architectureへの新規統合となり、Explicit Non-goalsに抵触するリスクがあるため見送った

## Production Changes

- `src/app/services/release_manager.py`:
  - import追加: `.engine_registry`から`create_default_registry`/`resolve_engine_id`
  - 新規関数: `_resolve_engine()`・`_engine_display_name()`・`_model_card_summary_line()`・`_model_card_charset_label()`・`_model_card_base_and_volume_line()`・`_model_card_known_limitations_lines()`・`_add_directory_artifact_to_zip()`
  - `build_model_card()`: engine解決・エンジン表示行の追加・「用途」「対象文字」「ベースモデル/学習量」「既知の制約」の4箇所をengineごとの文言へ変更（tesseractは既存文言を完全維持）
  - `build_deployment_package()`: engine解決・モデル実体の追加ロジックをtesseract既存分岐＋PaddleOCR/TrOCR用directory-walk分岐へ分離
  - モジュールdocstring: multi-engine対応の事実を追記
- `frontend/src/views/ReleasesView.jsx`: Deployment PackageボタンのtooltipテキストからTesseract固有の「traineddata」表記を除去し、engine非依存の「モデル実体」へ変更（1行のみ、他は無変更）

`src/app/services/release_gate.py`・`model_registry.py`・DB schema・APIエンドポイントのシグネチャはいずれも無変更。

## Compatibility

- 既存Tesseractの`test_model_card`/`test_deployment_package`（変更前から存在するテスト）は無変更のまま全件パス
- `model_config.json`・`RELEASE_NOTE.md`・`MODEL_CARD.md`・`preprocess_snapshot.json`というZIP内のファイル名・構造は変更していない（新しいファイルを追加していない、既存ファイル名のまま内容を拡充）
- Release Gate（`release_gate.py`）・release_manager.pyの他機能（ステータス遷移・Rollback・Release履歴）はいずれも無変更

## Tests

`tests/test_releases.py`へ以下を追加した（既存14テストに対し8テスト追加、計22テスト）。

- `test_model_card_paddleocr_engine_identity_and_fields`: engine表示・charset・ベースモデル/Epoch数の正しさ、Tesseract文言の非混入
- `test_model_card_trocr_engine_identity_and_fields`: 同上（TrOCR、charsetが「対象外」表示になること含む）
- `test_model_card_tesseract_wording_unchanged`: 既存Tesseract文言の完全な後方互換確認（回帰）
- `test_deployment_package_paddleocr_includes_directory_artifact`: ZIP内に`model/inference.pdmodel`等ディレクトリ一式が含まれること
- `test_deployment_package_trocr_includes_directory_artifact`: 同上（TrOCR、`model/config.json`等）
- `test_deployment_package_missing_artifact_directory_does_not_crash`: artifact directory不在時もZIP生成自体は失敗しない（fail-safe）
- `test_easyocr_models_are_unsupported_not_listed_in_releases`: EasyOCR形式ファイルが`list_releases()`に一切現れないことをテストで契約固定

実行結果:

```
python -m pytest -q tests/test_releases.py
# 22 passed

python -m pytest -q tests/test_audit_operations.py tests/test_dashboard_summary.py \
  tests/test_production_auth.py tests/test_recovery_atomicity.py \
  tests/test_release_gate.py tests/test_release_gate_trocr.py \
  tests/test_releases.py tests/test_reports.py
# 101 passed

python -m pytest -q
# 1325 passed（既知failureなし）

cd frontend && npm test
# 705 passed

cd frontend && npm run build
# 成功（既存のchunk-size警告のみ、無関係）
```

## Scope外（Explicit Non-goals、実施しなかったこと）

- Epic #28 Consumer Migration（Canonical Metadata基盤への切替）
- Canonical MetadataをProduction唯一のsource of truthへ変更
- `model_registry.py`全面再設計
- Evaluation/Benchmark architecture統合（Model CardへのBenchmark情報追加を含む、§Design Decision #8参照）
- Job lifecycle統合
- 新OCR Engine追加
- UI全面redesign（`ReleasesView.jsx`は1行のみの文言修正）
- Production deployment infrastructure新設

## Future Work

- Model CardへのBenchmark結果表示（全engine共通で現在未実装。追加する場合はEvaluation/Benchmark architectureとの統合設計が必要になるため、別Issueとして起票すべき）
- `release_gate.py::_latest_benchmark_result()`が`paddleocr_custom`/`paddleocr_official`のBenchmark行を一切マッチングしないことを発見した（`tesseract_model`/`trocr`のみ対応）。Release Gate自体の既存Benchmark evidence接続に関する未解決ギャップであり、本Issueの対象（Model Card/Deployment Package）とは別のため修正せず記録するに留めた
- `docs/10_KNOWN_LIMITATIONS.md`のModel Card/Deployment Package既知の制約に関する記述は、本Issueの実装完了を反映してdoc更新が必要（USER_GUIDE.mdは更新済み、§Documentation参照）
