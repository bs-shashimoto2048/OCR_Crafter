# 用語集（GLOSSARY）

OCR Crafterで使用する用語の説明です。画面上の「?」アイコン（ツールチップ）でも主要用語を確認できます。

## OCR基礎

| 用語 | 説明 |
|---|---|
| OCR | Optical Character Recognition。画像内の文字を読み取ってテキストにする技術 |
| Tesseract | オープンソースのOCRエンジン。CPUで動作し、LSTM fine-tune（追加学習）に対応 |
| PaddleOCR | PaddlePaddleベースのOCRエンジン。認識モデルの学習に対応し、GPUで高速化できる |
| YOLO | 物体検出モデル。OCR Crafterでは画像内の文字領域の検出（OCR画像作成）に使用 |
| Bounding Box / 検出領域 | 画像内の対象（文字列）を囲む矩形。YOLO検出の結果として得られ、切り出しに使う |
| charset | 学習対象の文字セット（例: `A-Z0-9klt+-`）。charset外の文字を含むラベルは学習サンプルから除外される |
| whitelist | 推論・評価時に「この文字だけを候補にする」制約。charset（学習対象）とは別概念で、学習には影響しない |
| PSM | Page Segmentation Mode。Tesseractのレイアウト解釈モード。単一行の文字列にはPSM 7を使用 |

## 学習

| 用語 | 説明 |
|---|---|
| Epoch | 学習データ全体を1周する回数（PaddleOCR・分類学習で使用。Tesseractでは使用しない） |
| Iteration | 学習の反復回数（Tesseract学習では「最大イテレーション」を指定） |
| Batch Size | 1回の学習ステップでまとめて処理する画像数。大きいほど速いがメモリを消費する |
| Learning Rate | 学習率。1回の更新でモデルをどれだけ動かすか |
| オーグメンテーション | 学習画像の水増し（コントラスト変化・ブラー・ノイズ・微小回転）。Trainデータのみに適用される |

## 評価

| 用語 | 説明 |
|---|---|
| CER | Character Error Rate（文字誤り率）。編集距離総和÷正解文字数総和のマイクロ平均。低いほど良い主指標 |
| Character Accuracy | 文字正解率。1−CER |
| Exact Match Rate | 完全一致率。認識結果が正解と完全一致（大小文字も区別）した画像の割合 |
| WER | Word Error Rate（単語誤り率）。単語単位の誤り率（OCR Crafterの主指標はCERで、WERは主要画面では使用しない） |
| Evaluation Profile | 評価実行時に保存される評価条件一式（データセット・画像数・評価前処理・エンジン・PSM・Whitelist・文字正規化・CER算出方式） |
| Evaluation Hash | Evaluation Profileから生成されるハッシュ。同一Hash＝同一条件評価（CERを直接比較できる根拠） |
| Preprocess Hash | 前処理設定のハッシュ。学習時・評価時の前処理条件の同一性確認に使う |
| Comparable Group | 同一Evaluation Hashの実験グループ（CG-0001形式）。グループ内のみCERを直接比較できる |
| Scientific Mode | 実験分析を比較可能な実験のみに限定するモード（既定ON） |

## Benchmark

| 用語 | 説明 |
|---|---|
| Benchmark | 複数OCRエンジンの同一条件での横並び比較（BM-0001形式）。精度・速度・メモリを計測 |
| Cold Start | エンジン・モデルの初回読み込み時間。推論時間とは分けて計測される |
| P50 / P95 | 処理時間の中央値（50パーセンタイル）/ 95パーセンタイル。P95は「遅いケースでもこの程度」の目安 |
| Peak Memory | 処理中の最大メモリ使用量 |
| Balance Score | 精度・速度などを重み付けして合算した総合スコア（重みはBenchmark設定で変更可能） |
| Profile Hash | Benchmark実行条件（前処理・エンジン設定）のハッシュ。同一Hash同士のみ直接比較できる |

## ID・管理

| 用語 | 説明 |
|---|---|
| Model ID（管理No） | M0001形式。モデルの管理番号。全プロジェクト横断で一意、削除後も再利用しない |
| Experiment ID | EXP-0001形式。学習実行ごとの実験カルテの識別子 |
| Release ID | REL-0001形式。昇格・Rollbackなど「リリース行為」1回ごとの識別子 |
| Version | 配布物の版番号。Candidate=0.x、Production初回=1.0.0→マイナー加算。RollbackではVersion維持 |
| Report ID | RPT-0001形式。生成したレポートの識別子 |
| Job ID | JOB-000001形式。バックグラウンドジョブの識別子（システム全体で一意） |
| Backup ID | BK-0001形式。バックアップの識別子 |

## リリース管理

| 用語 | 説明 |
|---|---|
| Draft | 学習直後の初期ステータス |
| Validated | 評価が完了したモデル（評価成功時に自動遷移） |
| Candidate | 本番候補のモデル（Version 0.xが付与される） |
| Production | 本番使用中のモデル。**各プロジェクトで0件または1件のみ** |
| Archived | 過去のモデル（新Production昇格時に旧Productionは自動でArchived） |
| Release Gate | Release Policy（Max CER等の基準）に基づく昇格の自動判定（PASS / CONDITIONAL_PASS / FAIL / NOT_EVALUATED） |
| Override | Gate判定FAILのモデルを例外承認で昇格すること。理由（Override Reason）と承認者（Approved By）が必須で、監査ログに記録される |
| Rollback | 過去リリースVersionのモデルをProductionへ戻すこと（Version維持・新Release ID発行） |

## 運用

| 用語 | 説明 |
|---|---|
| Job | バックグラウンドで実行される処理（前処理・学習・評価・Benchmark・レポート生成等の7種） |
| Worker | Jobを順番に実行するバックグラウンドスレッド。Job作成時に自動起動する |
| Interrupted | Job実行中にBackendが再起動された状態（「中断（再起動）」）。再実行で復旧できる |
| Atomic Write | ファイル書き込みを「一時ファイルに書いてから置き換える」方式。途中で落ちても壊れたファイルが残らない |
| SHA-256 | ファイルのハッシュ（指紋）。バックアップ・レポートの改ざん/破損検知に使用 |
| metadata_only | バックアップ種別: ラベル・実験/リリース記録などの記録類のみ（画像・モデル実体を含まない） |
| full backup | バックアップ種別: プロジェクトディレクトリ全体 |
