# 12_TESSERACT_CHARSET_SPEC（確定仕様）

Tesseract 関連の charset / whitelist の確定仕様。旧「a-z whitelist / 英小文字のみ」前提は廃止済み。

## 前提

実運用で出現する文字は以下であり、小文字筆記体として出現するのは k / l / t のみ。記号は + - のみ使用する。

- 英大文字: A-Z
- 数字: 0-9
- 英小文字筆記体: k / l / t
- 記号: + -（v1.0.0で追加。既存プロジェクトの保存済みcharset/whitelistは自動変更しない＝新規作成時の既定値と未設定時のフォールバック値のみが対象）

## 概念の分離

| 概念 | 既定値 | 役割 | 定義箇所 |
|---|---|---|---|
| 学習対象文字セット `TESSERACT_TARGET_CHARSET` | `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-` | 学習データに含めてよい文字（unicharsetが覚えるべき集合） | `services/tesseract_pipeline.py` |
| 推論時 whitelist `TESSERACT_WHITELIST_DEFAULT` | 同上（同値だが独立に変更可能な別定数） | `tessedit_char_whitelist` に渡す推論時の探索制約 | 同上 |
| 評価時 whitelist | 既定=実運用（上と同値）／空文字=なし／任意文字列=カスタム | 実運用条件での測定と比較実験の両立 | `OcrEvaluateRequest.charset` |

whitelist は**推論時の制御**であり、学習処理（lstmf生成・lstmtraining）には結び付けない。

## 学習データ正規化

- `text_case="keep"`（大小変換なし）。`CHYBkt` は `CHYBkt` のまま学習する。
- 学習対象文字セット外の文字を含むラベルは「文字を削除」ではなく**サンプルごと除外**し、
  skipped として集計・ログ出力する（画像と gt の不一致を作らないため）。
- `.gt.txt` / WordStr形式 `.box` / `.lstmf` リストはすべて **LF改行** で書く。

## 推論

- ベース `eng.traineddata`・学習済みモデルとも既定 whitelist は `A-Z0-9klt+-`。
- 学習済みモデルは `.tess.json` メタの `charset` を whitelist 既定として継承する
  （旧 a-z 学習モデルもメタ継承でそのまま動作＝互換維持）。
- TSV出力は `-c tessedit_create_tsv=1` で行う（`configs/tsv` ファイル非依存）。

## 評価

- 比較は **case-sensitive の完全一致**（trim＋Unicode NFC正規化のみ。NFKCは半角/全角等を同一視するため不使用）。`KT` と `kt` は別物として評価する。
- `charset` パラメータ: 既定=実運用 whitelist ／ 空文字=whitelistなし ／ 任意文字列=カスタム。
- 主指標は **CER**（全画像のLevenshtein編集距離総和÷正解文字数総和のマイクロ平均。画像ごとのCER平均ではない）。完全一致率（Accuracy）は業務指標として併記。
- 学習前(eng)・学習後(latest)を同一前処理入力で比較し、`comparison` に CER差・CER相対改善率・改善/同等/悪化・完全一致へ改善/から悪化を返す。

## UI表示

- 学習画面: 「Tesseract学習対象文字: A-Z / 0-9 / 小文字筆記体 k,l,t / 記号 +,-」
- 推論/バッチ/プレビュー: 「推論時 whitelist: A-Z / 0-9 / 小文字筆記体 k,l,t / 記号 +,-（既定）」
- 「英小文字のみ」「a-z whitelist」という表記は使用しない。
- Tesseract結果は大小文字を保持して表示・CSV出力する。

## PaddleOCR / EasyOCR への影響

- Paddle/EasyOCR 用の `OCR_CHARSET_DEFAULT`（`A-Z0-9`）は別定数・不変。
- `create_ocr_dataset` の既定 `text_case="upper"` も不変（Tesseract選択時のみ `keep` を指定）。

## 記号 `+` `-` の追加（v1.0.0）と扱い上の注意

- charset判定は `set(charset)` による**文字集合の所属判定**（`services/tesseract_pipeline.py` の `_generate_lstmf`）であり、`+` `-` を含めても正規表現の特殊記号として誤解釈されない。
- 文字クラス（`[...]`）を構成する形で charset を扱う場合は、`-` が範囲指定子と誤解釈されないよう **`re.escape()` を通す**こと（`tests/test_tesseract_charset.py::TestPlusMinusCharset::test_regex_character_class_escapes_hyphen_safely` で回帰）。
- `+` は保存・送信経路（JSON/API payload・CSV・Markdown/HTML表示）で欠落・変換されない。**URLクエリパラメータとしては送信しない**（`application/x-www-form-urlencoded` 規約で `+` が空白へ解釈されるため）。本アプリの charset は常にJSON POSTボディで送受信する。
- **既存プロジェクトの保存済みcharset・whitelistは自動変更しない**。今回変更したのは以下のみ:
  - 新規プロジェクト作成時の既定値（`TESSERACT_TARGET_CHARSET` / `TESSERACT_WHITELIST_DEFAULT` / `OcrEvaluateRequest.charset` / `TesseractTrainStartRequest.charset` / `config/settings.yaml default_charset` / フロントエンドの `TESSERACT_CHARSET_DEFAULT`）
  - 未設定時のフォールバック値
  既存モデルの `.tess.json` メタや、既にプロジェクトへ保存されたUI設定値は本変更の対象外（保存値が優先される）。
