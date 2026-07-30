# [Feature] TrOCR Model MetadataをFrontend推論UIへ連携

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [FEATURE_TROCR_FRONTEND_UI.md](FEATURE_TROCR_FRONTEND_UI.md)（Feature #23）/ [MODEL_METADATA.md](../../design/MODEL_METADATA.md)

Issue [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)の実装記録。

## 実装結果（2026-07-30）

### 事前調査で判明した重要な内容

**`ModelMetadata`（`src/app/services/model_metadata.py`）は、Feature #14で実装済みだが依然として既存コードへ一切配線されていない。** `model_metadata.py`自身以外のどのファイルからも`ModelMetadata`は参照されず、これを生成・保存・読込する処理はコードベース上どこにも存在しない。加えて、既存のモデル一覧処理（`model_registry.py::list_model_infos()`）が実際にスキャンするファイルパターンは`*.pt`（分類）・`*.ocr.json`（PaddleOCR）・`*.tess.json`（Tesseract）の3つのみで、**TrOCR用のファイル形式（`*.trocr.json`相当）は存在しない**（TrOCR学習自体が未実装のため）。

このため、「Model Metadataから登録済みTrOCRモデルを取得する」という当初の目的は、**実環境では常に0件を返す**ことになる。これは実装の不具合ではなく、TrOCR学習・モデル登録の仕組みがまだ存在しないことによる、現時点での正しい状態である。この制約は本Issueの範囲外（`新しいモデル管理基盤`は明示的に対象外）であるため、新しいファイル形式・Model Metadata Schemaの拡張は行わず、**既存の仕組みをそのまま使い、将来モデルが登録されれば自動的に機能する統合ポイントとして実装した。**

### 採用したデータソース・model_ref解決方法

- **モデル一覧API**: 新規APIは追加していない。既にApp.jsxが読み込み済みの`modelInfos`（`GET /models/info`の応答、`ModelsView.jsx`等でも共用）をそのまま再利用する
- **TrOCR識別方法**: `modelInfos[name].engine`を`normalizeEngineId()`（Issue #12実装分）で正規化し、`"trocr"`のものだけを抽出する。ファイル名・拡張子・`training_family`のみでの判定はしない
- **model_ref解決**: `ModelMetadata.artifact_path`（[MODEL_METADATA.md](../../design/MODEL_METADATA.md)が「将来の接続点」として既に言及していたフィールド）に相当する`info.artifact_path`を最優先する。存在しない場合はファイル名で代用せず、解決不能として扱う（`TrOCREngine.load()`はファイル名ルックアップではなくHugging Face model ID・ローカルパスをそのまま受け取るため、ファイル名を代用すると誤ったmodel_refを送信することになる）
- **表示ラベル**: 既存のエイリアス機構（`modelAliases[name] || name`、他のモデル表示箇所と同じ優先順位）を使う。`artifact_path`等のパス系フィールドはラベルに使用しない

### 実装内容

- **`frontend/src/lib/trocrModelMetadata.js`**（新設）:
  - `extractTrocrModels(models, modelInfos, modelAliases)`: `engine`正規化が`"trocr"`のものだけを`{name, label, modelRef}`の配列として抽出
  - `resolveSelectedTrocrModelRef(trocrModels, selectedName)`: 選択中モデル名からmodel_refを解決（未選択・未存在・解決不能は空文字）
  - `trocrMetadataValidationError(trocrModels, selectedName)`: 登録済みモデル方式のValidationエラー文言（有効なら`null`）
- **`frontend/src/App.jsx`**:
  - `trocrModels`（`useMemo`、既存の`modelInfos`/`models`/`modelAliases`から導出。新規fetchなし）
  - `inferTrocrModelSource`（`""`|`"metadata"`|`"manual"`。`""`は「未選択」で、登録済みモデルの有無に応じて動的に既定値を決める。ユーザーが明示的に選択した後は固定される）
  - `inferTrocrSelectedModel`（登録済みモデル方式での選択中モデル名）
  - `runInference()`: `inferEngine === "trocr"`のとき、方式に応じて`trocrMetadataValidationError()`または`trocrModelRefMissing()`で検証し、いずれかがエラーならAPI呼び出し前に停止。有効なら`resolveSelectedTrocrModelRef()`または`normalizeTrocrModelRef()`で解決した値を、既存の`model`フィールドへそのまま渡す
- **`frontend/src/views/InferenceView.jsx`**:
  - TrOCR選択時、「TrOCRモデル指定方法」ラジオボタン（登録済みモデルから選択／手動入力）を追加
  - 登録済みモデル方式: `trocrModels`が0件なら「登録済みTrOCRモデルはありません。手動入力をご利用ください。」を表示し、selectは出さない（空のselectを表示し続けない）。1件以上ならTrOCRモデルだけのselect（未選択時のplaceholder付き）を表示
  - 手動入力方式: Feature #23で実装済みの自由入力欄をそのまま維持
  - 実行ボタンの無効化条件へ、登録済みモデル方式の場合は`trocrMetadataValidationError()`の結果を追加
  - 「実際に使用される推論先」表示へ、登録済みモデル方式選択時は選択モデルの表示ラベル（絶対パスではない）を表示

### 初期選択のロジックと理由

「登録済みTrOCRモデルが存在する場合は登録済みモデルから選択、存在しない場合は手動入力」という動的な既定値を採用した。`trocrModels`は既にApp.jsx読み込み済みの`modelInfos`から同期的に導出する派生値であり、TrOCR選択のたびに新規fetchを発生させる設計ではないため、非同期取得によるちらつき・不安定な自動切替のリスクは無いと判断した。`inferTrocrModelSource`は「未選択（空文字）」を特別な状態として保持し、実際に描画・検証で使う値は`inferTrocrModelSource || (trocrModels.length > 0 ? "metadata" : "manual")`という導出値とすることで、ユーザーが一度明示的に選択した後は自動切替が起きないようにしている（先頭モデルの無条件選択・latestの自動選択は行っていない）。

### 送信内容

登録済みモデル方式・手動入力方式のいずれも、送信するFormDataは変わらない。

```text
engine=trocr
model=<解決済みmodel_ref または trim済み手動入力値>
```

`model_id`・`artifact_path`・`metadata_id`等のTrOCR専用フィールドは追加していない。`POST /predict`のRequest形式は変更していない。

### プロジェクト保存・復元

Feature #23と同様、`InferenceView.jsx`はテスト画面専用の一時的なUI状態であり、`inferTrocrModelSource`/`inferTrocrSelectedModel`/`inferTrocrModelRef`のいずれも永続化していない。DB Schema・Backend保存APIの変更は行っていない。

## 目的

Model MetadataからTrOCRモデルを取得し、推論画面で選択したモデルの参照先を既存`POST /predict`の`model`フィールドへ渡せるようにする。

## 対象

- 既存Model Metadata構造の調査
- 既存モデル一覧APIの調査
- TrOCRモデルの抽出
- FrontendのTrOCRモデル選択UI
- 手動入力との切り替え
- metadataからmodel_refへの安全な解決
- 既存`POST /predict`への送信
- モデル未選択時の検証
- Frontendテスト
- ドキュメント更新

## 対象外

- Model Metadata Schemaの全面変更
- 新しいモデル管理基盤
- Hugging Face検索
- モデルダウンロード
- Hub認証
- TrOCRモデル学習
- TrOCR評価
- Benchmark
- Release Gate
- Engineキャッシュ
- モデルロードキャッシュ
- Engine Registry API
- OcrBatchView対応
- RapidOCRView対応
- Issue #8修正
- Backend変更（既存`GET /models/info`をそのまま利用したため今回不要だった）

## テスト

- `frontend/tests/trocrModelMetadata.test.mjs`（新設）: `extractTrocrModels()`（engine抽出・他Engine除外・ファイル名判定でないことの確認・エイリアス優先・artifact_path解決・0件/null安全性）、`resolveSelectedTrocrModelRef()`、`trocrMetadataValidationError()`
- `frontend/tests/inferenceView.render.test.mjs`（既存ファイルへ追加）: 指定方法UIの表示・他Engineでの非表示・0件時の案内文・select表示（ラベルのみ、絶対パス非表示）・未選択/解決不能時の実行ボタン無効化・有効選択時の実行ボタン有効化・「実際に使用される推論先」表示・手動入力方式の維持確認
- 回帰: 既存552件のFrontendテスト（Issue #23まで）がすべて変更なしで通過することを確認
- Backend変更が無いため、新規Backendテストは追加していない。既存全Pythonテストのみ実行

## 受け入れ条件

- [x] Model MetadataからTrOCRモデル一覧を取得できる（既存Engine情報で判定。実環境では現時点で0件が正しい状態）
- [x] 推論画面で登録済みモデルから選択、または手動入力のいずれかでmodel_refを指定できる
- [x] 選択・入力されたmodel_refが既存`POST /predict`の`model`フィールドへ渡る
- [x] モデル未選択・一覧取得失敗時に安全に停止・表示する
- [x] 既存3Engine・既存TrOCR手入力機能に回帰がない
- [x] 新規テストが追加され通過する
- [x] ドキュメントが更新されている

## 次フェーズ

TrOCR Evaluation連携（[ISSUE_MAP.md](ISSUE_MAP.md)参照）。Issue #8は本Issueでも引き続き対象外。

## 補足資料

- [FEATURE_TROCR_FRONTEND_UI.md](FEATURE_TROCR_FRONTEND_UI.md)
- [MODEL_METADATA.md](../../design/MODEL_METADATA.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
