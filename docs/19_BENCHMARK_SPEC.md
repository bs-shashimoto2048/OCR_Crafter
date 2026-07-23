# 19. OCR Benchmark Suite（複数エンジン公平比較）

同一データセット・同一条件で複数のOCRエンジン/モデルを一括実行し、精度・速度・安定性を比較する。実装は `src/app/services/benchmark.py`、画面は `frontend/src/views/BenchmarkView.jsx`（サイドバー「運用 > Benchmark」）。実行は必ず **Job Management（`job_type=benchmark`）経由**（`docs/18_JOB_MANAGEMENT.md`）。

## 1. Benchmark ID・保存先

- 形式: `BM-0001`（4桁ゼロ埋め連番）。**プロジェクト内で一意**・再利用しない
- 保存先: `data/projects/<project_id>/benchmarks.json`（`{counter, items[], config}`）

## 2. 対応エンジン

| key | 対象 | Engine Profile |
|---|---|---|
| `tesseract_model` | OCR Crafterで学習・登録したTesseractモデル（.tess.json） | PSM / Whitelist |
| `tesseract_base` | Tesseract標準 `eng.traineddata`（学習前ベースライン） | PSM / Whitelist |
| `paddleocr_official` | PaddleOCR公式認識モデル（`OFFICIAL_PADDLEOCR_REC_MODELS`） | なし（PSM/Whitelistの概念なし） |
| `easyocr` | **未導入・利用不可**（カタログへ明示・実行対象外） | - |

- 未実装エンジンを指定すると `ValueError`（400）。UIでも選択不可＋「未導入・利用不可」バッジを表示
- クラウドOCR（Google Vision / Azure等）はローカル完結の設計方針により**対象外**（カタログへ掲載しない）
- 利用可否は `GET /api/benchmarks/engines` が実行環境を確認して返す（Tesseractバイナリ有無 / paddleocr import可否）

## 3. Profile（比較条件）と Profile Hash

条件は **common_profile（全エンジン共通）** と **engine_profiles（エンジン固有）** に分離する。PSM/WhitelistはTesseract系のみのEngine Profile。

Profile Hash = 以下の正規化JSONのsha256。**表示名（name）・実行日時は含めない**（同一Hash=同一条件のBenchmark）:

- common: データセットID / データセット内容Hash（画像名+正解文字列のsha256） / 画像数 / ラベル数 / 文字正規化バージョン（`trim+NFC`） / CERバージョン（`cer-v1-micro`） / 前処理識別子（現状 `none`=元画像のまま全エンジンへ同一入力）
- engines: `{engine, model, psm, whitelist}` の一覧（順序に依存しないようソートしてHash化）

履歴比較でProfile Hashが異なる場合は「⚠比較条件（Profile）が異なります」と警告する（比較自体は禁止しない）。

## 4. 結果項目（エンジン毎）

CER / 文字正解率(1−CER) / 完全一致率 / 正解数 / 置換・挿入・脱落数 / 失敗数（推論例外） / cold_start_seconds / warmup_runs・warmup_seconds / inference_seconds / total_seconds / mean_time_ms / p50_time_ms / p95_time_ms / peak_memory_mb / errors（最大20件） / confusions（TOP50） / completed_at

- **CER・混同集計は `ocr_evaluation.py` の共通ロジック（`levenshtein_ops` / `_normalize_compare`）を再利用**し、評価計算を重複実装しない
- 失敗ケースは空予測（全脱落）としてCERへ算入する（除外して精度を偽らない）
- `peak_memory_mb` は本環境では外部プロセス（Tesseract）やネイティブ実装のピークメモリを正確に取得できないため **null（推測値を入れない）**

## 5. 公平性（タイミング分離）

- `cold_start_seconds`: Runner生成（モデルロード）の時間
- `warmup_runs` / `warmup_seconds`: ウォームアップ実行（既定1回・先頭画像）。**統計（mean/p50/p95）へ含めず回数と時間のみ記録**
- `inference_seconds`: 画像毎推論時間の総和（mean/p50/p95の母集団）
- `total_seconds` = cold_start + warmup + inference
- 全エンジンが**同一の画像リスト・同一の入力画像**で順次実行される（並列実行によるリソース競合を避ける）

## 6. Leaderboard・用途別ベスト

- **Leaderboard**: CER昇順。同率は 完全一致率降順 → 失敗数昇順 → 平均時間昇順（CER未算出は最下位）
- **用途別ベスト**: 最高精度（CER最小） / 完全一致率最高 / 最速（MeanTime最小） / 最少失敗 / バランス最良
- **バランス最良の計算式**（UIへ明示表示）:

```text
score = w_acc × 文字正解率(1−CER) + w_speed × (最速MeanTime ÷ 自MeanTime) + w_stab × (1 − Failed/Total)
```

重みの既定は accuracy 70% / speed 20% / stability 10%。プロジェクト毎に `PATCH /api/benchmarks/config` で変更可能（合計1へ正規化。`benchmarks.json` の `config.balance_weights`）。

## 7. 画像単位比較

各画像 × 各エンジンの `{prediction, match, failed, edit_distance, time_ms}` を保存。フィルタ（`frontend/src/lib/benchmarkLogic.js`）:

全件 / どれか失敗 / Engine間不一致（予測文字列が異なる） / 全Engine不正解 / 特定Engineのみ正解（Engine選択必須）

大量ケース表は50件/ページのページングで描画する。

## 8. CSV Export（Excel対応）

3種（BOM付きUTF-8）を `GET /api/benchmarks/{bm_id}/export?kind=...` で出力:

- `benchmark_summary_BM-xxxx.csv` — エンジン別結果＋Profile Hash
- `benchmark_cases_BM-xxxx.csv` — 画像×エンジンの明細
- `benchmark_confusions_BM-xxxx.csv` — エンジン別混同（置換/挿入/脱落）

## 9. API（`docs/06_API_REFERENCE.md` 参照）

| Method / Path | 概要 |
|---|---|
| GET `/api/benchmarks/engines` | 対応エンジンカタログ＋利用可否 |
| GET `/api/benchmarks` | 一覧（新しい順・Leaderboard/用途別ベスト付き・casesなし）＋重み設定 |
| POST `/api/benchmarks` | 実行（条件検証→job_type=benchmarkのJob作成。重複はdeduplicated） |
| PATCH `/api/benchmarks/config` | バランス重み設定 |
| GET `/api/benchmarks/{bm_id}` | 詳細（cases含む） |
| GET `/api/benchmarks/{bm_id}/export` | CSV（Excel対応）3種 |

## 10. テスト

- バックエンド: `tests/test_benchmark.py`（BM採番・Profile Hash・未実装エンジン拒否・実行結果項目・Leaderboardソート・用途別/バランス式・重み設定・CSV3種・Jobハンドラ統合）
- フロント: `frontend/tests/benchmarkLogic.test.mjs`（フィルタ5種・ページング・Profile警告）、`benchmarkView.render.test.mjs`
