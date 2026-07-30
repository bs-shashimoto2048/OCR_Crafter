# [Feature] 既存OCR推論APIへTrOCR統合

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [FEATURE_PIPELINE_TROCR.md](FEATURE_PIPELINE_TROCR.md) / [TROCR_BACKEND.md](../../design/TROCR_BACKEND.md)

Phase4の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase4「既存OCR推論APIへの統合」）。OCR PipelineへのTrOCR統合（[#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)）は完了済み。

## 実装結果（2026-07-30）

### 事前調査で判明した内容

- OCR推論を実際に受け付ける既存Routerは主に5つ（`src/app/main.py`）: `POST /predict`（単一画像・engine/model直接指定）、`GET`/`POST /preprocess/preview`（`_attach_preview_prediction()`経由）、`POST /api/ocr/predict/batch`、`POST /api/ocr/yolo/predict`、`POST /api/ocr/preview-file/batch`（Step5比較UI）。いずれも最終的に`predict.py::predict_from_image()`を呼ぶ
- 今回の対象は**`POST /predict`のみ**とした。画像アップロード＋`engine`＋`model`を直接指定する最も単純な既存OCR推論APIであり、Section 2で示された`engine="trocr"`/`model=<model_ref>`/`image=<入力>`という形に最も直接対応するため
- `engine`フィールドは全箇所でプレーンな`str`（Literal/Enumなし）。`/predict`は`Form("custom")`で制限なし。**Engine Registry上の制限もなく、`resolve_engine_id()`はPipeline側（`predict.py`、PR #19）に既に実装済みのため、Router側でengine値を制限するコード変更は不要だった**
- **Response Schemaは存在しない**（全predict系エンドポイントが`response_model`未指定の`dict[str, Any]`を返す）。よってconfidence等のnullable化のためのSchema変更は不要
- `model`フィールドが既存のmodel_ref相当フィールド。`/predict`は`Form("latest")`
- `/predict`は`async def`だが`predict_from_image()`（重い同期処理）を直接呼び出しており、Thread Pool等でオフロードしていない（既存3エンジンも同様。TrOCR固有の問題ではないため今回は変更せず、Future Workへ記録）
- 例外変換: `/predict`は既に`HTTPException→再送出 / FileNotFoundError→404 / ValueError→400 / Exception→400`という汎用catch-allを持つ。predict.py側でTrOCR固有例外は既に`RuntimeError`へ変換済み（PR #19）のため、**追加の例外変換コードは不要**（既存の`except Exception→400`がそのまま拾う）

### 実装内容

`src/app/main.py`と`src/app/schemas.py`のみを変更した。

- `POST /predict`に、`resolve_engine_id(engine) == "trocr"`のとき`model`（model_ref）が空文字・空白のみなら`HTTPException(400)`を返す検証（`_require_trocr_model_ref()`）を追加。それ以外のエンジンには一切影響しない
- Router自身はTrOCREngineを直接呼び出さない。従来どおり`predict_from_image()`を呼ぶのみ（`Router → predict_from_image() → resolve_engine_id() → TrOCREngine`という既存経路をそのまま利用）
- `schemas.py::PreprocessPreviewRequest`の`engine`/`model`フィールドのdescription文字列へtrocrの記述を追記（型・Enum化はしない。ドキュメントのみの変更）
- 新規TrOCR専用エンドポイント・Request/Response Schemaは作成していない

### model_ref（modelフィールド）の扱い

- `model`は既存フィールドをそのまま`predict_from_image()`の`model`引数へ渡す。TrOCR専用の新規フィールドは追加していない
- `engine="trocr"`かつ`model`が空文字・空白のみの場合は`400 model (model_ref) is required when engine=trocr`
- `model`省略時の既定値`"latest"`は暗黙変換しない。そのまま`predict_from_image()`へ渡り、Pipeline側（`_predict_with_trocr()`）の既存仕様どおり実際のロード時に失敗する（Feature #18のFuture Workで既知の制約として記録済み）
- Hugging Face Hub ID・ローカルパスのいずれも、Router側での追加検証・書き換えなしにそのまま通す
- Routerからネットワークアクセス・`from_pretrained()`呼び出しは一切行わない

### local_files_only

- 現在のPipeline/API呼び出し仕様に存在しないため、今回APIパラメータとして追加していない
- そのため**API経由のTrOCR推論はHugging Face Hubへアクセスする可能性がある**（`model`にHub上のmodel IDを指定した場合）。社内運用ではネットワークアクセスを避けるため、**ローカルモデルパスの指定を推奨する**
- `local_files_only`のAPI公開は、必要性を確認した上で別Issueとして検討する

### 画像入力・レスポンス

- 既存の`multipart/form-data`（`UploadFile`）をそのまま利用。TrOCR用の別入力形式は追加していない
- 既存の画像サイズ制限・MIME検証・一時ファイル削除処理（`finally`節）はそのまま適用される
- レスポンスは既存の`dict[str, Any]`形状をそのまま維持。TrOCR専用レスポンスSchemaは作成していない。`text`/`prediction`/`engine`（`"trocr"`）/`confidence`（`None`、捏造しない）/`char_scores`（`[]`）がそのまま返る。`TrOCRResult`型自体・`model_ref`という名前のフィールド・ローカル絶対パスはレスポンスへ露出しない（`model_name`に呼び出し時のmodel_refがそのまま入るが、これは呼び出し側が自ら指定した値であり新規の情報漏洩ではない）

### エラー変換

- 追加のエラー変換コードは実装していない（predict.py側で`TrOCRDependencyError`/`TrOCRModelLoadError`/`TrOCRInferenceError`が既に`RuntimeError`へ変換済みのため、`/predict`の既存`except Exception→400`がそのまま処理する）
- `_require_trocr_model_ref()`による明示的な400のみ新規に追加
- 既存のグローバル例外正規化（`_http_exception_unified`/`_unhandled_exception_as_json`、統一エラー形式）は無変更。スタックトレース・例外型名は元々レスポンスへ出ない設計であることを確認済み

### Engine Registry / Model Metadataとの関係

- Engine Registry本体は変更していない。`trocr`は既にbuiltin Engineとして登録済み
- API Schemaは独自のEngine一覧を保持していない（`engine: str`のみ）ため、Registry連携のための追加変更は不要
- Model Metadataとは今回も接続しない。APIの利用者は既存の`model`フィールドへTrOCRのmodel_refを直接指定する

### モデルキャッシュ

- APIレベルのキャッシュは追加していない。`TrOCREngine`はPipeline側（`_predict_with_trocr()`）が呼び出しごとに`load()`する既存の挙動のまま
- PipelineレベルでのTrOCREngineインスタンス再利用はFeature #18よりFuture Workとして記録済み（[ISSUE_MAP.md](ISSUE_MAP.md)参照）

### 対象外にした他の推論エンドポイント

`/preprocess/preview`（GET/POST）・`/api/ocr/predict/batch`・`/api/ocr/yolo/predict`・`/api/ocr/preview-file/batch`は、engine/model文字列を制限していないため`engine="trocr"`自体は今回のコード変更なしに引き続き通る。ただし`_require_trocr_model_ref()`と同等の明示的なmodel_ref必須検証は`/predict`にのみ追加した（一部のエンドポイントは`RuntimeError`系の汎用catch-allを持たないため、model_ref未指定時の失敗が`/predict`ほど明確な400にならない場合がある）。詳細は[ISSUE_MAP.md](ISSUE_MAP.md)のFuture Work参照。

## 目的

既存OCR推論APIで`engine="trocr"`とモデル参照を指定し、アップロード画像に対するTrOCR推論結果を既存レスポンス形式で返せるようにする。

## 対象

- 既存OCR推論Router（`POST /predict`）
- Request Schemaの説明文への追記（`PreprocessPreviewRequest`）
- 必要最小限のService接続確認
- APIテスト
- ドキュメント更新

## 対象外

- TrOCR専用API
- Frontend
- Issue #12
- Model Metadata Adapter
- Engineキャッシュ
- TrOCR学習
- TrOCR評価
- Benchmark統合
- Release Gate統合
- Issue #8

## テスト観点

`tests/test_api_trocr_inference.py`を新設（実transformers・実モデル・実ネットワーク不使用、`predict_from_image()`をモック）。

- 正常系: `engine="trocr"`受理、model_refの伝播、アップロード画像の既存経路への伝播、既存レスポンス形状の維持、HTTP 200
- 正規化: `trocr`/`TrOCR`/前後空白/`TROCR`
- model_ref: Hub ID形式・ローカルパス形式・空文字・空白のみ（400）・`latest`（暗黙変換せずそのまま伝播）
- 異常系: 未知engine、model_ref未指定、TrOCR依存関係不足相当・モデルロード失敗相当・推論失敗相当のRuntimeError、不正画像相当のValueError（いずれも400へ変換）
- セキュリティ: エラーレスポンスへスタックトレース・例外型名・ローカル絶対パスを含めない
- 回帰: Tesseract/PaddleOCR/EasyOCR/customが引き続き正しく動作すること
- OpenAPI Schema: `/openapi.json`が生成でき、`PreprocessPreviewRequest`のdescriptionにtrocrが含まれること

## 受け入れ条件

- [x] 既存`POST /predict`が`engine="trocr"`と`model`（model_ref）を受け付ける
- [x] RouterがTrOCREngineを直接呼び出さず、既存の`predict_from_image()`経由の経路を利用する
- [x] engine判定の独自実装を追加していない（`resolve_engine_id()`はPipeline側で既に一元化済み）
- [x] TrOCR選択時にmodel_ref未指定を明確な400として扱う
- [x] `"latest"`を暗黙変換していない
- [x] 既存レスポンス形状を維持し、TrOCRResult型・ローカル絶対パスを露出していない
- [x] 新規テストが追加され通過する（実モデル・ネットワーク不使用）
- [x] 既存エンジン（Tesseract/PaddleOCR/EasyOCR/custom）に回帰がない
- [x] 既存テストスイートに影響がない（Issue #8起因の既知失敗を除く）
- [x] ドキュメントを更新している

## 補足資料

- [FEATURE_PIPELINE_TROCR.md](FEATURE_PIPELINE_TROCR.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
