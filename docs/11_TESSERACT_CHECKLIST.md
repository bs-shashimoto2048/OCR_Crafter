# 11_TESSERACT_CHECKLIST

Tesseract の学習・推論・評価が動くことを確認するチェックリスト（Windows PowerShell 前提、バックエンドは `http://127.0.0.1:8000` 起動済みとする）。

> 学習対象文字セット: `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`（A-Z / 0-9 / 小文字筆記体 k,l,t）
> whitelist（推論時の探索制約）は別概念。既定は学習対象と同値。詳細は `docs/12_TESSERACT_CHARSET_SPEC.md`。

## 1. ツールの存在確認

推論と学習で必要なものが異なる:

- **推論**: `tesseract` 本体のみ（通常のインストーラで可）
- **学習**: `tesseract` 本体に加えて `lstmtraining` / `combine_tessdata`（合成データ生成には `text2image`）

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
& "C:\Program Files\Tesseract-OCR\lstmtraining.exe" --version
& "C:\Program Files\Tesseract-OCR\combine_tessdata.exe" 2>$null
```

- [ ] tesseract がバージョンを表示する
- [ ] lstmtraining / combine_tessdata が存在する（UB-Mannheim ビルドは同梱）
- [ ] 未導入で学習開始した場合、導入手順つきの 400 エラーになる

## 2. eng.traineddata（tessdata_best）の配置

fine-tune のベースには **tessdata_best 版**（float モデル、約15MB）が必要。インストーラ同梱の fast 版（約4MB）では LSTM 抽出後の学習品質が落ちる。

- 取得元: https://github.com/tesseract-ocr/tessdata_best
- 配置先: `config/settings.yaml` の `tesseract.tessdata_dir`（既定: `models/tessdata_best`）
- [ ] `<tessdata_dir>/eng.traineddata` が存在する（約15MB = best版）
- [ ] `<tessdata_dir>/configs/lstm.train` が存在する（インストーラの tessdata/configs をコピー）

## 3. config/settings.yaml

```yaml
tesseract:
  tesseract_cmd: "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
  lstmtraining_cmd: "C:\\Program Files\\Tesseract-OCR\\lstmtraining.exe"
  combine_tessdata_cmd: "C:\\Program Files\\Tesseract-OCR\\combine_tessdata.exe"
  tessdata_dir: "C:/path/to/ocr_crafter/models/tessdata_best"
  base_lang: eng
  default_charset: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt
  default_max_iterations: 1000
  default_psm: 7
```

- [ ] 設定変更後にバックエンドを再起動した（`get_settings` はキャッシュ）

## 4. 学習データセット作成（新規作成）

UI: `モデル作成 > 学習` で `学習方式=ocr` / `OCRタイプ=Tesseract` → `OCRデータ作成`。
API: `POST /api/ocr/dataset/create`（`charset=A-Z0-9klt`, `text_case=keep`, `image_shape=[1,48,320]`）

- [ ] `meta.json` の `charset` が `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`、`text_case` が `keep`
- [ ] `train.txt` のラベルが元の表記のまま（`CHYBkt` が `chybkt`/`CHYBKT` に改変されない）
- [ ] charset外の文字を含むラベルは「文字削除」ではなく**サンプル除外**される

## 5. from_logs 再学習データ作成

`POST /api/ocr/log/save` で保存したOCRログから `POST /api/ocr/dataset/from_logs`（`text_case=keep`）で作成。

- [ ] `dataset.txt` のラベルが元表記のまま（大文字・筆記体klt混在を保持）
- [ ] `skipped.charset` が想定内（charset外はサンプル除外）

## 6. 学習の実行

`POST /api/tesseract/train/start`（`dataset_dir`, `max_iterations`, `base_lang=eng`, `psm=7`）。
状態/ログは `GET /api/ocr/train/status/{job_id}` / `GET /api/ocr/train/log/{job_id}`。

- [ ] `queued → running → completed` に遷移する
- [ ] ログに「学習対象文字セット外のサンプルを除外しました: train=N / eval=M」が出る（該当時）
- [ ] `models/tesseract/<name>/<name>.traineddata` と `<name>.tess.json` が生成される

実装上の要点（過去の不具合の再発チェック）:
- [ ] `.gt.txt` と WordStr形式 `.box` が生成される（box無しでは lstmf 生成が全滅する）
- [ ] `train.lstmf.list` / `.gt.txt` / `.box` が **LF改行**（CRLFだと lstmtraining が "Deserialize header failed" になる）

## 7. モデル登録・管理

- [ ] `GET /models` に `<name>.tess.json` が出る
- [ ] `GET /models/info` に engine=tesseract / charset / traineddata_path / ocr_inference_ready が入る
- [ ] `GET /models/latest?training_family=tesseract` がモデル名を返す
- [ ] UI `モデル管理` に traineddataパス・charset・学習条件が表示される
- [ ] `GET /api/models/download/<name>.tess.json` で `.traineddata` を取得できる

## 8. 推論（engine=tesseract）

`POST /predict`（Form: engine=tesseract, model=latest|eng|`<name>.tess.json`）。

- [ ] `model=eng` で eng.traineddata（学習前ベースライン）推論ができる
- [ ] `model=latest` で学習済み最新モデルの推論ができる
- [ ] 認識結果が whitelist（`A-Z0-9klt`）内の文字のみ
- [ ] TSV信頼度（confidence）が返る
- [ ] Tesseract未導入環境では導入案内つきエラー（クラッシュしない）

## 9. 評価（学習前後比較）

UI: `モデル作成 > 学習 > 6. モデル評価`。API: `POST /api/ocr/evaluate`
（targets に eng と latest、`charset=A-Z0-9klt`＝実運用whitelist、空文字=whitelistなし）。

- [ ] 比較は **case-sensitive**（`KT` と `kt` は別物）
- [ ] `comparison` に増減・改善率が入る
- [ ] 正解CSVは `filename,text` 形式・実運用の表記どおり（例: `CHYBkt`）

## 10. バッチ推論 / OCR修正

- [ ] `バッチ推論` でエンジン Tesseract＋モデル（latest / eng / 一覧）を選択できる
- [ ] 結果の大小文字が保持される（`CHYBkt` が `CHYBKT` にならない）
- [ ] 結果CSV出力に engine / model が記録される
- [ ] `OCR修正`（RapidOCR）でも Tesseract を選択でき、確定でOCRログが保存される

## 11. モデル削除（安全ガード）

- [ ] 削除で `.tess.json` と `models/tesseract/<name>/` が消える
- [ ] `models` ルート・プロジェクトは無傷
- [ ] メタの関連パスが models 外の場合は実体を削除せず警告ログ（手動削除の案内つき）
- [ ] 破損（JSONパース不能）メタは警告つきでメタファイルのみ削除される
- [ ] 関連パス欠落（読めるが空）のメタは削除中止（400）

## 12. よくあるエラーと原因

| メッセージ / 症状 | 原因 | 対処 |
|---|---|---|
| `tesseract 実行ファイルが見つかりません`（推論時） | 本体未導入 / パス未設定 | 本体を導入し `tesseract.tesseract_cmd` 設定 or PATH |
| `Tesseract 学習ツール...が見つかりません。未検出: ...` | lstmtraining等が無い | 学習ツール入りビルドを導入し `*_cmd` 設定 |
| `ベース traineddata (eng.traineddata) が見つかりません` | tessdata_dir 未配置 | §2 のとおり tessdata_best 版を配置 |
| lstmf生成で `Cannot read box data` | `.box` 未生成（旧バグ） | 最新コードでは WordStr形式 box を自動生成 |
| `Deserialize header failed`（lstmtraining） | list/gt/box が CRLF | 最新コードでは LF固定。手作りデータはLFで保存 |
| 学習後モデルの評価/認識が常に空文字 | `tsv` 設定ファイル依存（旧バグ） | 最新コードは `-c tessedit_create_tsv=1` で configs 非依存 |
| `train.txt に有効な学習サンプルがありません` | charset外/文字数で全件除外 | ラベルと学習対象文字セットを確認 |
| `deletion outside allowed directories is not permitted` | output_dir が許可外（安全ガード） | 出力先をプロジェクトの outputs 配下にする |
