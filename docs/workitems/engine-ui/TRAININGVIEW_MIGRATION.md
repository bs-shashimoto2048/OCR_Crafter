# TrainingView Migration 作業記録

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Refactor [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)（TrainingViewをEngine Registryへ移行） / [ENGINE_REGISTRY_DESIGN.md](../../ENGINE_REGISTRY_DESIGN.md) / Engine Registry Core [#49](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/49) / ModelsView Migration [#51](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/51)

本ドキュメントは、`TrainingView.jsx`のEngine固有処理を`frontend/src/config/engineRegistry.js`へ移行した作業（Refactor #53）の記録である。

## 移行前のハードコード箇所

| 箇所 | 内容 |
|---|---|
| OCRタイプ`<select>`（677-682行付近） | `<option>`3個をハードコード（value・表示名・補足文すべて固定） |
| `engineDisplayLabel`/`engineSummaryLabel`（498-504行付近） | `ocrEngine==="paddleocr"?...:ocrEngine==="tesseract"?...:"EasyOCR"`という三項演算子（暗黙のelse=EasyOCR） |
| 学習回数入力のdisabled（694行付近） | `disabled={ocrEngine === "easyocr"}`という直接比較 |
| デバイス選択ボタン3個のselectable（708-737行付近） | `!isTesseractEngine && ocrEngine !== "easyocr"`等のEngine ID直接比較 |
| エンジン固有設定パネル（1146-1520行付近） | `ocrEngine==="easyocr"?(...):isTesseractEngine?(...):(...)`という三項演算子チェーン（暗黙のelse=PaddleOCR設定） |
| ジョブスナップショット（1573-1613行付近） | `String(jobInfo.engine||"")==="tesseract"?...:==="paddleocr"?...:jobInfo.engine||"--"`の重複したラベル判定と、tesseract/その他の2値フィールドレイアウト分岐 |
| 実行操作ブロックの表示ゲート（1947行付近） | `{ocrEngine !== "easyocr" ? (...) : null}` |

## Registryへ追加した項目

`frontend/src/config/engineRegistry.js`のtesseract/paddleocr/easyocr/trocrエントリへ以下を追加（customは対象外。理由は後述）。

- `trainingSupported: boolean` — 学習を実際に実行できるか
- `trainingSelectable: boolean` — 学習画面のOCRタイプ選択肢に表示してよいか
- `supportedDevices: ("cpu"|"gpu")[]` — 学習時にサポートする演算デバイス
- `trainingPanel: "paddleocr"|"tesseract"|"unsupported"` — エンジン固有設定パネルの種別
- `snapshotType: "tesseract"|"generic"` — ジョブスナップショットのフィールドレイアウト種別

値は`src/app/services/engine_capability.py::BUILTIN_CAPABILITIES`（`supports_training`/`supports_cpu`/`supports_cuda`）および既存`TrainingView.jsx`の実装済み挙動と一致させた（推測で新規Capabilityを作らない）。

| Engine | trainingSupported | trainingSelectable | supportedDevices | trainingPanel | snapshotType |
|---|---|---|---|---|---|
| tesseract | true | true | `["cpu"]` | `"tesseract"` | `"tesseract"` |
| paddleocr | true | true | `["cpu","gpu"]` | `"paddleocr"` | `"generic"` |
| easyocr | **false**（推論専用） | true（選択肢には表示） | `[]` | `"unsupported"` | `"generic"` |
| trocr | **false**（Backend未実装） | **false**（選択肢に表示しない） | `["cpu","gpu"]`（Capability値のみ、未使用） | `"unsupported"` | `"generic"` |
| custom | 対象外 | 対象外 | 対象外 | 対象外 | 対象外 |

`custom`（分類モデル）は`engine_capability.py`のEngine Capability登録対象外であり、かつ学習画面のOCRタイプ選択肢そのものの対象外（`trainingFamily`/`modelType`という別軸で扱う）であるため、推測でCapability値を作らずフィールド自体を持たせなかった。

## 選択肢生成方法

`getTrainingSelectableEngines()`（新設の公開API）が、`trainingSelectable===true`のエントリのみを、学習画面専用の固定順序（PaddleOCR→Tesseract→EasyOCR→TrOCR、trocrはtrainingSelectable=falseのため結果には含まれない）で`{id, label}`の配列として返す。この順序はRegistryエントリ自体の汎用フィールドにはせず、`getTrainingSelectableEngines()`関数内部の定数として保持した（表示順は「学習エンジン選択」という利用文脈固有の情報であり、他画面（例: 将来のModelsView一覧フィルタ）が同じ順序を必要とするとは限らないため）。

`<option>`の補足文（「（学習可）」「（推論専用）」等）とTesseractの charset 説明文は、学習UI固有の説明文でありEngine単位の汎用capability情報ではないため、`TrainingView.jsx`内のローカルな`TRAINING_ENGINE_OPTION_SUFFIX`定数として保持した（Registryへは追加しない）。

## 学習可否

`isEngineTrainingSupported(engineId)`へ一本化した。学習回数入力のdisabled、「実行操作」ブロックの表示ゲートの両方がこの1つの関数を参照する（同じ判定を複数箇所に複製しない）。

- PaddleOCR/Tesseract: `true`（既存どおり学習回数入力有効・実行操作ブロック表示）
- EasyOCR: `false`（既存どおり学習回数入力無効・実行操作ブロック非表示）
- TrOCR: `false`（学習画面のOCRタイプ選択肢に出せないため、通常操作では到達不能。外部から`ocrEngine="trocr"`が渡された場合でも学習不可として扱われることをテストで確認済み）
- 未登録Engine: `false`（PaddleOCR/Tesseractへのフォールバックはしない）

## デバイス対応

`getEngineSupportedDevices(engineId)`/`isEngineDeviceSupported(engineId, deviceId)`へ移行した。Autoボタンの選択可否は「複数デバイスに対応しているか」（`supportedDevices.length > 1`）から導出し、CPU/GPUボタンはそれぞれ`isEngineDeviceSupported(engineId, "cpu"/"gpu")`（GPUはさらに実機検出`systemCheck.gpu_available`と組み合わせる）から導出した。既存3Engineそれぞれの`selectable`値が完全に一致することを手動導出で確認済み（詳細はPR本文参照）。

**Tesseract固有の「デバイス選択UI自体を常時ロックする」挙動（`isTesseractEngine`による`clickable`/`selected`/`fixedCpu`の上書き）はRegistry化せず、既存の`ocrEngine === "tesseract"`直接比較のまま維持した。** これは単なる「デバイス対応可否」ではなく、Tesseract固有のUI表示ロジック（CPU固定でクリック不可）であり、`supportedDevices`のみから安全に一般化しようとすると、EasyOCR（対応デバイス0件）との区別が難しくなり回帰リスクが高いと判断したため（詳細はENGINE_REGISTRY_DESIGN.md Future Work参照）。

## 設定パネル選択

`getEngineTrainingPanel(engineId)`が返す`"paddleocr"|"tesseract"|"unsupported"`を、`switch`相当の明示的な分岐（`trainingPanel === "tesseract" ? (...) : trainingPanel === "paddleocr" ? (...) : (...)`）で使用する。最後の`else`は「未対応」の安全な通知表示であり、PaddleOCR設定への暗黙フォールバックではない。EasyOCR固有の通知文言（「EasyOCR はこのUIでは学習対象外です。推論画面でのみ利用できます。」）は維持しつつ、それ以外（TrOCR・未登録Engine）には汎用の「このエンジンはこのUIでは学習対象外です。」を表示する。

## スナップショット表示

ジョブのEngineラベルは`getEngineLabel(jobInfo.engine) ?? (jobInfo.engine || "--")`とし、未登録Engineの生の値をそのまま表示する（PaddleOCR等への暗黙フォールバックはしない）。フィールドレイアウト（PSM/最大iteration vs 最大文字数/エポック数）は`getEngineSnapshotType(jobInfo.engine) === "tesseract"`で判定する。

## TrOCRは学習選択肢へ追加していない

`ENGINE_REGISTRY`のtrocrエントリは`trainingSelectable: false`・`trainingSupported: false`を維持しており、`getTrainingSelectableEngines()`の返り値には含まれない。OCRタイプ`<select>`のoptionにも`value="trocr"`は出現しない（テストで確認済み）。これは「TrOCR学習未実装」という現状を表すものであり、TrOCR UI統合ではない。

## unknown EngineをPaddleOCR扱いしない

すべての移行箇所（表示名・学習可否・デバイス・設定パネル・スナップショット）で、未登録・未知のEngine値は「不明」表示または安全側（未対応・disabled）へフォールバックし、PaddleOCR（またはTesseract/EasyOCR）へ暗黙に振り分けられることがないことをテストで確認した。

## UI見た目は変更していない

既存の`frontend/tests/trainingView.render.test.mjs`44件（移行前から存在）が無修正のまま全件成功することを確認した。新規追加した20件のテストも、既存3Engine（PaddleOCR/Tesseract/EasyOCR）については既存の表示文言・順序・disabled条件と完全一致することを確認している。

## Backend/API無変更

`src/app/`配下・`App.jsx`・API呼び出し（`onStartOcrTraining`等のコールバック呼び出し形式）はいずれも変更していない。

## Future Work

- Tesseractの「デバイス選択UI常時ロック」挙動の一般化（現状は`isTesseractEngine`直接比較のまま）
- `TRAINING_ENGINE_OPTION_SUFFIX`（学習UI固有の補足文言）をRegistryへ統合するかどうかの判断
- `engineRegistry.js`のラベルテーブル統合（ENGINE_REGISTRY_DESIGN.md 9章優先順位1）は本Featureでも未着手のまま
- TrainingView以外の画面（Benchmark/Evaluation）のEngine Registry移行
