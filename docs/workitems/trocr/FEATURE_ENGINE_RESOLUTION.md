# [Refactor] Engine判定ロジックをEngine Registryへ統一

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / Feature [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)（Engine Registry、実装済み）

Phase2の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase2「既存バグ修正・Engine判定の一本化」）。TrOCR対応ではない。

## 背景

Engine Registry（#9）は実装済みだが、既存OCR処理ではまだ利用されていない。現状、Engine判定ロジックが複数箇所に個別実装されており、うち一部は「未指定・不明ならPaddleOCRとみなす」という暗黙フォールバックを持つ。

事前調査の結果、暗黙フォールバックが実在する箇所は以下4箇所と判明した。

- `src/app/services/model_registry.py::list_model_infos()`（`.ocr.json`分岐）: `str(payload.get("engine") or "paddleocr")`
- `src/app/services/ocr_pipeline.py::migrate_ocr_models_to_inference()`: `str(payload.get("engine") or "paddleocr").strip().lower()`
- `frontend/src/views/ModelsView.jsx::engineLabelOf()`: `family==="ocr"`かつ`engine!=="tesseract"`なら無条件`"PaddleOCR"`
- `frontend/src/lib/inferenceModel.js::resolveInferenceEngine()`: 同様に`family==="ocr"`なら無条件`"paddleocr"`

**このIssueで対応するのはBackend側2箇所（model_registry.py / ocr_pipeline.py）のみ。** Frontend側2箇所は、JS側にRegistry相当ロジックを新設せず・Engine ID定義を複製せず・API追加も行わない方針のため、今回は対象外とし、別Issue候補として記録する（詳細は「Frontendの未対応事項」参照）。

なお`src/app/services/release_gate.py::_model_engine()`も判定ロジックの重複箇所として調査対象だったが、こちらは未知拡張子に対し既に空文字`""`を返す設計（暗黙のpaddleocrフォールバックは無い）ため、今回の「暗黙フォールバック廃止」の対象外とする。

## 目的

Engine Registryを利用して、Backend側の**Engine判定のみ**を統一する。OCR処理そのものは変更しない。

## 対象

- `src/app/services/model_registry.py::list_model_infos()`
- `src/app/services/ocr_pipeline.py::migrate_ocr_models_to_inference()`
- Engine判定ユーティリティ（`src/app/services/engine_registry.py`への最小限の補助関数追加）

## 対象外

- TrOCR実装
- Model Metadata
- Handler（TrainingHandler/InferenceHandler/EvaluationHandler等）
- OCRアルゴリズム変更
- Benchmark改善
- Frontend変更（`ModelsView.jsx::engineLabelOf()` / `inferenceModel.js::resolveInferenceEngine()`を含む）
- API追加
- [Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)の修正

## 現在の動作

`model_registry.py`・`ocr_pipeline.py`とも、`.ocr.json`の`engine`フィールドが未指定・空の場合、無条件で`"paddleocr"`とみなす。不正な値（大文字・未知文字列等）を渡しても正規化されるだけで、判定不能なケースの区別が無い。

## 期待する動作

`engine_registry.py`に追加する判定ヘルパー（Engine Registryの`exists()`を利用）経由で、既知4エンジン（tesseract/paddleocr/easyocr/trocr）のいずれかに一致する場合のみそのengine_idを採用する。一致しない場合（None・空文字・未登録の値）は`"unknown"`として扱い、暗黙に`"paddleocr"`とはみなさない。

## Backend変更

- `src/app/services/engine_registry.py`: Engine判定用の最小限の補助関数を追加（Factory化・Handler化・Metadata対応は行わない）
- `src/app/services/model_registry.py` / `src/app/services/ocr_pipeline.py`: 上記の暗黙フォールバックを、Registry経由の明示的な判定へ置き換える

## API変更

なし

## UI変更

なし

## データ構造・永続化への影響

`.ocr.json`の`engine`フィールドが未指定の既存モデルは、一覧表示上`"paddleocr"`から`"unknown"`に変わる可能性がある（ファイル自体は変更しない）。現状の`data/projects/`には該当データが無いことを確認済みだが、挙動変化として明記する。

## Modelへの影響

`list_model_infos()`が返す`engine`フィールドの値が変わりうる（上記参照）。

## Benchmarkへの影響

なし（`services/benchmark.py`は変更しない）

## テスト観点

- Engine Registry判定ヘルパー: tesseract/paddleocr/easyocrの正常系、Unknown Engine・None・空文字・大文字・不正IDの異常系
- `model_registry.py` / `ocr_pipeline.py`の回帰テスト（既存の暗黙フォールバックに依存していたテストが無いか確認）
- 既存テストスイート（`python -m pytest -q`）が全て通過する

## 受け入れ条件

- [x] `engine_registry.py`へEngine判定用の最小限の補助関数を追加している（Factory/Handler/Metadata対応は含まない）
- [x] `model_registry.py`の暗黙paddleocrフォールバックを廃止している
- [x] `ocr_pipeline.py`の暗黙paddleocrフォールバックを廃止している
- [x] Unknown Engineを明示的に扱っている（暗黙フォールバックなし）
- [x] 単体テストを追加し通過する
- [x] 既存テストスイートに影響がない（[Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)起因の既知失敗を除く）
- [x] Frontend（`ModelsView.jsx`/`inferenceModel.js`）は変更していない

## Frontendの未対応事項

`ModelsView.jsx::engineLabelOf()`と`inferenceModel.js::resolveInferenceEngine()`は、Backendと同種の「PaddleOCRへの暗黙フォールバック」を持つが、今回は対象外。JS側にRegistry相当ロジックを新設しない・Engine ID定義を複製しない・Backend Registry情報をFrontendへ返す新規APIを作らない、という方針のため、対応するには別途設計判断（FrontendでどうEngine判定を行うか）が必要。

別Issue候補として以下を記録する（今回はIssue作成・コード着手ともに行わない）。

```text
[Bug] Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする
```

## 補足資料

- [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
