# 12_TESSERACT_CHARSET_SPEC（確定仕様）

Tesseract 関連の charset / whitelist の確定仕様。旧「a-z whitelist / 英小文字のみ」前提は廃止済み。

## 前提

実運用で出現する文字は以下であり、小文字筆記体として出現するのは k / l / t のみ。

- 英大文字: A-Z
- 数字: 0-9
- 英小文字筆記体: k / l / t

## 概念の分離

| 概念 | 既定値 | 役割 | 定義箇所 |
|---|---|---|---|
| 学習対象文字セット `TESSERACT_TARGET_CHARSET` | `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt` | 学習データに含めてよい文字（unicharsetが覚えるべき集合） | `services/tesseract_pipeline.py` |
| 推論時 whitelist `TESSERACT_WHITELIST_DEFAULT` | 同上（同値だが独立に変更可能な別定数） | `tessedit_char_whitelist` に渡す推論時の探索制約 | 同上 |
| 評価時 whitelist | 既定=実運用（上と同値）／空文字=なし／任意文字列=カスタム | 実運用条件での測定と比較実験の両立 | `OcrEvaluateRequest.charset` |

whitelist は**推論時の制御**であり、学習処理（lstmf生成・lstmtraining）には結び付けない。

## 学習データ正規化

- `text_case="keep"`（大小変換なし）。`CHYBkt` は `CHYBkt` のまま学習する。
- 学習対象文字セット外の文字を含むラベルは「文字を削除」ではなく**サンプルごと除外**し、
  skipped として集計・ログ出力する（画像と gt の不一致を作らないため）。
- `.gt.txt` / WordStr形式 `.box` / `.lstmf` リストはすべて **LF改行** で書く。

## 推論

- ベース `eng.traineddata`・学習済みモデルとも既定 whitelist は `A-Z0-9klt`。
- 学習済みモデルは `.tess.json` メタの `charset` を whitelist 既定として継承する
  （旧 a-z 学習モデルもメタ継承でそのまま動作＝互換維持）。
- TSV出力は `-c tessedit_create_tsv=1` で行う（`configs/tsv` ファイル非依存）。

## 評価

- 比較は **case-sensitive の完全一致**（trim＋Unicode NFC正規化のみ。NFKCは半角/全角等を同一視するため不使用）。`KT` と `kt` は別物として評価する。
- `charset` パラメータ: 既定=実運用 whitelist ／ 空文字=whitelistなし ／ 任意文字列=カスタム。
- 主指標は **CER**（全画像のLevenshtein編集距離総和÷正解文字数総和のマイクロ平均。画像ごとのCER平均ではない）。完全一致率（Accuracy）は業務指標として併記。
- 学習前(eng)・学習後(latest)を同一前処理入力で比較し、`comparison` に CER差・CER相対改善率・改善/同等/悪化・完全一致へ改善/から悪化を返す。

## UI表示

- 学習画面: 「Tesseract学習対象文字: A-Z / 0-9 / 小文字筆記体 k,l,t」
- 推論/バッチ/プレビュー: 「推論時 whitelist: A-Z / 0-9 / 小文字筆記体 k,l,t（既定）」
- 「英小文字のみ」「a-z whitelist」という表記は使用しない。
- Tesseract結果は大小文字を保持して表示・CSV出力する。

## PaddleOCR / EasyOCR への影響

- Paddle/EasyOCR 用の `OCR_CHARSET_DEFAULT`（`A-Z0-9`）は別定数・不変。
- `create_ocr_dataset` の既定 `text_case="upper"` も不変（Tesseract選択時のみ `keep` を指定）。
