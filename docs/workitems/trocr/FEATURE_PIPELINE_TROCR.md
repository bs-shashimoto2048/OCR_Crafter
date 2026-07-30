# [Feature] OCR PipelineへTrOCR統合

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [TROCR_BACKEND.md](../../design/TROCR_BACKEND.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [FEATURE_TROCR_INFERENCE_CORE.md](FEATURE_TROCR_INFERENCE_CORE.md)

Phase4の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase4「TrOCR推論Backend」相当）。TrOCR単画像推論コア（[#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）はすべて完了済み。

## 実装結果（2026-07-30）

### 事前調査で判明した接続点の修正（コード修正前にユーザーへ報告・承認済み）

当初の想定は「`src/app/services/ocr_pipeline.py`がエンジン別の推論分岐を持つOCR Pipelineである」だったが、実際に調査した結果は以下のとおりだった。

- `ocr_pipeline.py`はPaddleOCR学習・Dataset作成・GPU検出等のモジュールであり、エンジン別の推論分岐は含まれていない
- 実際の推論ディスパッチは`src/app/predict.py::predict_from_image()`であり、`engine`引数の文字列に応じて`_predict_with_easyocr()`/`_predict_with_paddleocr()`/`_predict_with_tesseract()`を呼び分け、`dict[str, Any]`（事実上の既存OCRResult）を返している
- 正式な`OCRResult`クラスは存在しない
- `resolve_engine_id()`（Engine Registry、PR #13でmodel_registry.py/ocr_pipeline.pyへ導入済み）は`predict.py`内では未使用で、素の文字列比較（`engine_name == "..."`）でエンジン判定していた

この結果をユーザーへ報告し、対象ファイルを`ocr_pipeline.py`から`predict.py`へ変更する承認を得た上で実装した（Issue [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)本文に記録済み）。

### Pipeline変更点

`src/app/predict.py`のみを変更した。

- `predict_from_image()`内のエンジン判定を、素の文字列比較（`engine_name = (engine or "custom").strip().lower()` → `if engine_name == "easyocr": ...`）から、`resolve_engine_id(engine, registry=create_default_registry())`の戻り値（`resolved_engine_id`）による判定へ統一した。既存3エンジン（Tesseract/PaddleOCR/EasyOCR）も含めて同じ判定方式へ揃えている（`resolve_engine_id()`は既知の4エンジンいずれについても同じ正規化＝前後空白トリム＋小文字化を行うため、既存3エンジンの挙動は変化しない）
- `resolved_engine_id == "trocr"`のとき、新設した`_predict_with_trocr(ocr_input_source, model)`を呼び、既存3エンジンと同様に`preprocess_applied`/`preprocess_image_type`/`preprocess_pipeline`をマージして返す
- CLI（`predict.py::main()`）の`--engine`選択肢へ`"trocr"`を追加した

### TrOCREngine呼び出し

`_predict_with_trocr(image_source, model_ref)`を新設。

- `TrOCREngine.load(model_ref)`を呼び出しのたびに実行する（本Issueのスコープで新規キャッシュは作らない。`TrOCREngine`のライフサイクルは呼び出しごとの`load()`のみ）
- `image_source`が`PIL.Image.Image`であれば`engine.predict(image_source)`、それ以外（画像パス文字列）であれば`engine.predict_file(image_source)`を呼ぶ（`TrOCREngine`自体のファイル/画像判定ロジックをpredict.py側で重複実装しない）

### model_ref解決

Model Metadata・Engine Registry経由の新規モデル解決ロジックは追加していない。`predict_from_image()`が既存の3エンジンに対して保持している`model`パラメータ（呼び出し側が指定する既存のモデル参照）を、そのまま`TrOCREngine.load()`の`model_ref`として渡す。

- 既存3エンジンのような`.ocr.json`/`.tess.json`ファイル探索（`resolve_model_path()`/`resolve_ocr_model_meta()`）はTrOCRには適用しない（TrOCR学習・Model Metadata接続は本Issueの対象外のため、対応するモデル管理形式がまだ存在しない）
- そのため`model`未指定時の既定値`"latest"`をTrOCRへ渡すと、Hugging Face Hub上の`"latest"`という名前のモデルロードを試みて失敗する（`TrOCRModelLoadError`→`RuntimeError`）。TrOCRを使う場合は呼び出し側が実際のmodel_ref（例: `"microsoft/trocr-base-printed"`）を明示的に指定する必要がある。この制約はModel Metadata接続時に見直す

### OCRResult変換

`TrOCRResult`（`text`/`engine_id`/`model_ref`のみ）を、既存の`_predict_with_tesseract()`と同型のdict（`text`/`prediction`/`confidence`/`engine`/`model_name`/`model_type`/`valid`/`validation`/`char_scores`/`char_confidence_normalized`）へ変換する。TrOCRはconfidence/char_scoresを持たないため、それぞれ`None`/`[]`とする（捏造しない）。変換は`_predict_with_trocr()`内で完結し、`TrOCRResult`自体がPipeline外（API等）へ渡ることはない。

### 例外変換

`TrOCRDependencyError`/`TrOCRModelLoadError`/`TrOCRInferenceError`（いずれも`TrOCRError`のサブクラス）を、`_predict_with_trocr()`内で`RuntimeError`へ変換する（既存の`_get_easyocr_reader()`がeasyocr未導入時に送出する例外と同じ種別）。`ValueError`（不正な画像・model_ref）や`FileNotFoundError`（画像ファイル不存在）は`TrOCREngine`側で既にCLAUDE.md記載の既存変換規則（`FileNotFoundError→404`/`ValueError→400`）と合致する型のため、追加の変換をしていない。

## 目的

既存OCR推論経路からTrOCREngineを利用できるようにする。

## 対象

- `src/app/predict.py`（推論ディスパッチ）
- `TrOCRResult`→既存OCRResult（dict）変換
- 必要最小限のimport
- Pipeline関連テスト
- ドキュメント更新

## 対象外

- API
- Frontend
- 学習
- 評価
- Benchmark
- Release Gate
- Model Metadata Adapter
- Engine Registry（`resolve_engine_id()`の利用のみ。Registry自体は変更していない）
- `trocr_engine.py`本体の設計変更（未変更）
- [Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)
- [Issue #12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)

## テスト観点

`tests/test_predict_trocr_pipeline.py`を新設（実transformers・実モデル不使用、`TrOCREngine`をフェイクへ差し替え）。

- 正常系: `_predict_with_trocr()`が画像パス経由で`predict_file()`を呼ぶこと／`PIL.Image`経由で`predict()`を呼ぶこと、変換後dictの形状
- 異常系: `TrOCRDependencyError`/`TrOCRModelLoadError`/`TrOCRInferenceError`がいずれも`RuntimeError`へ変換され、TrOCR固有例外自体は外へ漏れないこと
- `predict_from_image()`経由: `engine="  TrOCR  "`（大文字混在・前後空白）が`resolve_engine_id()`の正規化により`trocr`分岐へ到達すること（文字列比較ではないことの確認）
- 回帰確認: 未登録engine文字列がtrocrへ誤って分岐しないこと、既存3エンジン（EasyOCR/PaddleOCR/Tesseract）が引き続き正しく分岐すること（各エンジンのヘルパーをモックし、trocr側が呼ばれないことを確認）

## 受け入れ条件

- [x] `predict_from_image(engine="trocr")`でTrOCREngineが呼ばれ、結果が既存OCRResult形状のdictへ変換される
- [x] Engine判定は`resolve_engine_id()`のみで行い、文字列比較の分岐を残していない
- [x] 既存エンジン（EasyOCR/PaddleOCR/Tesseract）に回帰がない
- [x] TrOCR固有例外がPipeline外（呼び出し側）へ漏れない
- [x] 新規テストが追加され通過する（実モデル・ネットワーク不使用）
- [x] 既存テストスイートに影響がない（[Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)起因の既知失敗を除く）
- [x] ドキュメントを更新している

## 補足資料

- [TROCR_BACKEND.md](../../design/TROCR_BACKEND.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
