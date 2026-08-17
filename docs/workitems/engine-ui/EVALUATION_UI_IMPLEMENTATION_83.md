# Evaluation UI Implementation 作業記録

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Feature [#83](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/83)（Evaluation UI Implementation） / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59)（Evaluation UI Generalization Design、[EVALUATION_UI_GENERALIZATION.md](../../EVALUATION_UI_GENERALIZATION.md)） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) 配下 Feature [#79](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/79)（Multi-engine Evaluation API Integration、PR [#80](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/80)・Merge Commit `e496b91`）

**状態（作業時点）**: Implemented, PR review pending。

## 目的

`OcrEvaluationView.jsx`（モデル評価画面）はTesseract専用（Engine軸自体が存在しない）だった。Design #59で確定した方針どおり、Backend側のMulti-engine Evaluation API（Issue #79、`POST /api/ocr/evaluate`のPaddleOCR/EasyOCR/TrOCR対応）を前提に、画面側へEngine選択・Engine別モデル/オプションUIを追加し、Tesseract以外の単発評価も同画面から実行できるようにする。

## 実装前調査（既存コードとの整合）

- `OcrEvaluationView.jsx`はEngine概念自体を持たず、`tesseractModels`という命名のprop・whitelist UI・学習前後比較（`includeBase`）がすべてTesseract固有のまま実装されていた（EVALUATION_UI_GENERALIZATION.md 3章・4.1章の指摘どおり）。
- `InferenceView.jsx`（推論テスト画面）が既にTesseract/PaddleOCR/EasyOCR/TrOCRの4Engine選択UI・Engine別モデルピッカー（PaddleOCRモデル+言語、EasyOCR言語チェックボックス、TrOCR登録済みモデル/手動入力+デバイス+local_files_only）を実装済みだったため、本Featureはこれをそのまま踏襲した（新しいUIパターン・新しいEngine判定ロジックを発明しない）。
- TrOCRのmodel_ref解決・実行ボタン無効化判定は`lib/inferenceModel.js`（`trocrModelRefMissing`）・`lib/trocrModelMetadata.js`（`resolveSelectedTrocrModelRef`/`trocrMetadataValidationError`）の既存純関数をそのまま再利用し、判定基準を重複定義しなかった。
- Backend`services/evaluation_multi_engine.py::build_predictor()`が実際に読む`options`キー（PaddleOCR: `language`/`use_angle_cls`、EasyOCR: `languages`、TrOCR: `device`/`local_files_only`）を実コードで確認し、それ以外のキーを送らないようにした。
- Backendは非Tesseractエンジンを含むリクエストの`preprocess_mode="training"/"training_individual"`を明示的に`ValueError`で拒否する（`_UNSUPPORTED_PREPROCESS_MODES`）ため、UI側でもTesseract以外選択時は「学習時前処理を使用」「Step5同期」の選択肢自体を表示しないようにした（選べても実行時400になる状態を作らない）。
- Multi-engine経路の応答は`preprocess_source`キーを返さない（Tesseract固有のlegacy概念のため）。既存の「`preprocess_source === undefined` → 未記録（旧形式の結果）」という判定ロジックをそのまま使うと、Tesseract以外の正常な評価結果が誤って「旧形式」と表示されてしまうため、`preprocess_mode`の有無で分岐するようフロントエンドのみで補正した（Backend契約は変更していない）。

## Scope

- **対象**: `frontend/src/views/OcrEvaluationView.jsx`・`frontend/src/App.jsx`（評価実行関数・state配線）・新規`frontend/src/lib/ocrEvalEngine.js`
- **対象外（明示的に変更しない）**: Backend Evaluation API（Issue #79実装済みのまま無変更）・`BenchmarkView.jsx`/`BenchmarkCenterView.jsx`（Design #59の結論どおり別画面として個別対応）・Models APIのHTTPエンドポイント配線・Engine横断`comparison`の一般化（Multi-engine経路は従来どおり常に`null`）・Tesseract選択時の挙動（既存targetsペイロード・whitelist・学習前後比較は1バイトも変更しない）

## 実装内容

### `frontend/src/lib/ocrEvalEngine.js`（新規）

Engine別のOcrEvalTarget構築・評価前処理モードの許容判定を純関数として切り出した（`frontend/src/lib/`への切り出し方針に従う）。

- `EVALUATION_ENGINE_IDS`: Evaluation対応済み4Engine（`custom`は含まない。Evaluation Dispatcherに未登録のため）
- `buildOcrEvalTargets()`: Tesseractは既存挙動を1バイトも変えず（`options`フィールドを追加しない）、他Engineはtarget1件のみ（学習前後比較の概念が無いため）
- `isPreprocessSourceAllowedForEngine()` / `resolvePreprocessSourceForEngine()`: 非Tesseractengineでは`training`/`step5`を許容しない
- `isTrocrEvalModelUnresolved()`: 既存`trocrModelRefMissing`/`trocrMetadataValidationError`を再利用したTrOCR実行可否判定

### `OcrEvaluationView.jsx`

- 「評価対象モデル」カードへ評価エンジン選択（`getEngineLabel()`によるRegistry駆動ラベル）を追加
- エンジンに応じ「評価対象モデル」欄を切替: Tesseract=既存のまま（学習前後比較+whitelist）／PaddleOCR=モデル+言語+use_angle_cls／EasyOCR=言語チェックボックス／TrOCR=モデル指定方法（登録済み/手動）+デバイス+local_files_only（InferenceView.jsxと同一UIパターン）
- whitelist設定はTesseract選択時のみ表示（Tesseract固有機能のため）
- 評価前処理モードの選択肢はEngineに応じてフィルタ（非Tesseractでは学習時前処理・Step5同期を非表示）
- TrOCR選択時、model_ref未解決なら「評価を実行」ボタンを無効化
- 結果表示の前処理ラベルをMulti-engine経路（`preprocess_source`無し）でも正しく表示するよう補正

### `App.jsx`

- 評価画面専用の新規state（`ocrEvalEngine`・PaddleOCR/EasyOCR/TrOCR用state）を追加。推論テスト画面（`inferEngine`等）とは完全に独立させた（既存の「推論に使用モデル」と「テスト用選択」を混同させない設計方針を踏襲）
- `handleOcrEvalEngineChange()`: Engine切替時、選択中の評価前処理モードがそのEngineで使えない場合のみ`none`へフォールバック
- `runOcrEvaluation()`: `buildOcrEvalTargets()`を使ってEngine別にtargetsを構築するよう変更（Tesseractの既存挙動は無変更）。TrOCR選択時はmodel_ref未解決なら送信前に停止

## Backend（無変更）

`src/app/`配下は本Featureで一切変更していない。Multi-engine Evaluation API（Issue #79）は実装済みのまま利用するのみ。

## Tests

- `frontend/tests/ocrEvalEngine.test.mjs`（新規、15件）: Engine別target構築・前処理モード許容判定・TrOCR実行可否判定
- `frontend/tests/ocrEvaluationView.render.test.mjs`（新規、11件）: Engine選択肢表示・Tesseract既存フロー無回帰・PaddleOCR/EasyOCR/TrOCR別UI表示・TrOCR未解決時のボタン無効化・前処理モード選択肢のEngine別フィルタ・Multi-engine結果の前処理ラベル表示
- `frontend/package.json`のtestスクリプトへ上記2ファイルを追加（既存はglobではなく明示列挙のため）
- `npm run build && npm test`: 670件全pass（既存644件+新規26件）
- Backend: `python -m pytest -q tests/test_api_evaluation_integration.py tests/test_evaluation_multi_engine.py`（40件pass）・全体`python -m pytest -q`（1179件pass、既知Issue #8含め新規failureなし。本Featureは`src/app/`を変更していないため元々無影響）

## Future Work（Scope外として記録）

- Tesseract以外の評価結果を「モデル管理」画面の評価履歴（モデルカルテ）へ表示する際の専用UI（現状はmodel名キーでの汎用記録機構にそのまま乗るのみで、Engine別の専用表示は無い）
- Engine横断の`comparison`（学習前後比較に相当する概念）の一般化
- PaddleOCR/EasyOCR/TrOCRの評価設定（language・use_angle_cls等）の永続化（Tesseractのwhitelist等と異なりlocalStorage保存を持たない。既存`ocrEval*` stateも同様に非永続のため、既存方針に合わせた）
