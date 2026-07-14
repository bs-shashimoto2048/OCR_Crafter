# 05. コーディング規約（コードから読み取れる実態）

Lint/フォーマッタの設定ファイルは存在しないため、以下はコードベースの実際のパターンを記述したもの。

## 命名規則

### Python（`src/app/`）

| 対象 | 規則 | 例 |
|---|---|---|
| モジュール | snake_case | `manual_mask.py`, `ocr_pipeline.py` |
| 関数 | snake_case | `run_preprocess`, `predict_from_image` |
| 内部関数 | `_` プレフィックス | `_op_threshold`, `_build_preprocess_config` |
| クラス | PascalCase | `ProjectPaths`, `PreprocessPreviewRequest` |
| 定数 | UPPER_SNAKE_CASE | `OCR_CHARSET_DEFAULT`, `STRICT_OCR_EXPORT_REQUIRED` |

### JavaScript（`frontend/src/`）

| 対象 | 規則 | 例 |
|---|---|---|
| コンポーネントファイル | PascalCase.jsx | `LabelingView.jsx`, `Button.jsx` |
| libファイル | camelCase.js | `candidateDictionary.js` |
| 関数・変数 | camelCase | `saveAndNext`, `decideNextImageIndex` |
| 定数 | UPPER_SNAKE_CASE | `EASYOCR_LANGUAGE_OPTIONS`, `DICT_FILE_MAX_BYTES` |
| localStorageキー | `ocr_<用途>_v1`（プロジェクト別は `_by_project_` を含む） | `ocr_preprocess_params_by_project_v1` |

## ファイル配置

- バックエンド: エンドポイントは `main.py` に集約、ドメインロジックは `services/` へ分離。スキーマは `schemas.py` に集約。
- フロントエンド: 画面=`views/`、再利用UI=`components/`、UI非依存の純関数=`lib/`（テスト対象は `lib/` に置く方針が実態）。
- テスト: バックエンド=`tests/test_*.py`、フロントエンド=`frontend/tests/*.test.mjs`。

## コメントルール

- コメント・docstringは**日本語**（例: `preprocess.py`, `manual_mask.py`, `latin_case.py` のモジュールdocstring）。
- 「なぜそうするか」を説明するコメントが多い（例: `main.py` のCORSミドルウェア順序、`candidateDictionary.js` の方式選定理由）。
- TODO/FIXME/HACK マーカーは**リポジトリ内に存在しない**（将来対応は `# 将来:` 表記が1件のみ: `services/ocr_evaluation.py`）。

## エラー処理

### バックエンド

- エンドポイント内で `FileNotFoundError → 404`、`ValueError → 400` へ `HTTPException` 変換するパターンが標準。
- 未捕捉例外はミドルウェア `_unhandled_exception_as_json` が JSON 500 に変換（CORSヘッダ維持のため）。
- 広域catchには `except Exception as e:  # noqa: BLE001` を明示（50箇所以上）。
- 破壊的操作は多重ガード: `normalize_project_id`（パストラバーサル拒否）、`safe_rmtree`（許可ルート配下限定）、`delete_model` の models 配下検証。

### フロントエンド

- `lib/api.js` の `request()` がエラー応答の `detail` を解析して `Error` を throw、呼び出し側は `try/catch` で `notify("error", message)` 表示。
- localStorage/sessionStorage は常に `try/catch` で包み、不可環境でも動作継続。
- 比較スロット等の並列リクエストは行単位でエラーを保持し、1件の失敗を他へ波及させない。

## 非同期処理

- バックエンド: エンドポイントは基本同期関数。ファイルアップロード系のみ `async def` + `await file.read()`。学習は `Popen` による**別プロセス**（asyncioではない）。
- フロントエンド: `async/await` + `fetch`。プレビューは 300ms デバウンス、レスポンス競合は「リクエスト連番 ref」「cancelled フラグ」「プロジェクトIDタグ」で破棄する防御パターンが確立している。

## 型定義

- Python: 関数シグネチャに型ヒントあり（`Optional[str]`, `dict[str, Any]`, `list[int]` 等）。`typing.Any` の使用が多い。mypy等の型チェック設定は**存在しない**。
- Pydantic: APIリクエストは `BaseModel` + `Field(description=...)` で日本語説明付き。
- JavaScript: TypeScript不使用。JSDocの型注釈も体系的には使われていない（コメントで引数説明を書くスタイル）。

## テストの書き方

- pytest: 日本語のテスト関数コメント/セクションコメント、`temp_projects` フィクスチャで実データから隔離、`monkeypatch` で外部コマンドを差し替え。外部ツール必須のE2Eは `skipif` でスキップ。
- node:test: `test("日本語のテスト名", ...)` + `assert/strict`。純関数のみを対象。

## コミットメッセージ（git logの実態）

- 形式: `<type>: <英語要約>`（type: feat / fix / ui / refactor）
- 本文は日本語の箇条書き（変更点の詳細）
