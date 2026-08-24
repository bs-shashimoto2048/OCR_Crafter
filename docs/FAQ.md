# FAQ（よくある質問）

用語の詳細は [GLOSSARY.md](GLOSSARY.md)、操作手順は [USER_GUIDE.md](USER_GUIDE.md) を参照してください。

## 全般

**Q. OCR Crafterは何ができますか**
A. 画像の取り込み・前処理・ラベル付け・データセット作成・OCRモデルの学習（Tesseract/PaddleOCR/TrOCR）・評価・推論・修正・モデル管理・リリース管理・レポート生成までを、ローカル環境のWeb UIで一貫して行えます。

**Q. Tesseract・PaddleOCR・TrOCRの違いは何ですか**
A. いずれも学習・推論に対応するOCRエンジンです。Tesseractは軽量でCPUのみで動作し、LSTM fine-tune（既定charset `A-Z0-9klt+-`）に対応します。PaddleOCRはディープラーニングベースの認識モデルを学習でき、GPUで高速化できます。TrOCRはHugging Face Transformers（`VisionEncoderDecoderModel`）ベースで、Hugging Face Hub上の公開モデルや自プロジェクトで学習したモデルをfine-tuneできます（confidence・PSM/Whitelistの概念は無し）。用途に対する優劣はデータ依存のため、Benchmarkで同一条件比較して選定してください。

**Q. GPUは必須ですか**
A. 必須ではありません。全機能がCPUで動作します。GPUがあるとPaddleOCR学習などが高速化されます。

**Q. 学習画像は何枚必要ですか**
A. 一律の基準はありません（データの難易度・文字種に依存します）。少数から始めて評価し、誤認識の多い文字のデータを追加していく反復を推奨します。実験管理の条件推薦は比較可能な実験が5件以上そろうと参考情報を提示します。

**Q. 学習データと評価データを分ける理由は何ですか**
A. 学習に使った画像で評価すると精度が実力以上に高く出るためです。評価データセット作成画面には学習データとの重複チェック機能があります。

## 指標・評価

**Q. CERとは何ですか**
A. Character Error Rate（文字誤り率）。全画像の編集距離の総和÷正解文字数の総和（マイクロ平均）で、低いほど良い主指標です。CER 5%は「文字レベルで95%正解」に相当します。

**Q. Character Accuracy（文字正解率）とは何ですか**
A. 1−CER。文字レベルの正解率です。

**Q. 完全一致率とは何ですか**
A. 画像単位で認識結果が正解文字列と完全一致（大文字・小文字も区別）した割合です。

**Q. Evaluation Hashとは何ですか**
A. 評価条件（データセット・画像数・評価前処理・エンジン・PSM・Whitelist・文字正規化・CER算出方式）から生成されるハッシュ値です。同一Hash＝同一条件の評価であり、CERを直接比較してよい根拠になります。

**Q. Comparable Groupとは何ですか**
A. 同一Evaluation Hashを持つ実験のグループ（CG-0001形式）。同一グループ内の実験だけがCERを直接比較できます。

**Q. Scientific Modeとは何ですか**
A. 実験管理の分析（CER推移・相関・推薦）を「比較可能な実験のみ」に限定するモードです（既定ON）。OFFにすると全実験が対象になりますが、評価条件が混在した参考値であることが明示されます。

**Q. Benchmark Runnerとモデル評価の違いは何ですか**
A. モデル評価は「1つのモデルの精度測定と学習前後の比較」、Benchmark Runnerは「複数エンジンを実際に実行して同一条件で横並び比較（精度に加え速度・メモリも計測）」です。

**Q. Benchmark RunnerとBenchmark Centerの違いは何ですか**
A. Benchmark Runnerは複数OCRエンジンを**実際に実行**して測定する実行ツールです。Benchmark Centerはそれとは別の画面で、Dataset Manager・実験管理・モデル管理にすでに蓄積された評価結果を**実行せずに横断比較**するだけの参照ビューです。新しい評価は行わず、コード・保存先ともBenchmark Runnerとは完全に分離しています。

## モデル・リリース

**Q. Productionモデルは複数登録できますか**
A. できません。Productionは各プロジェクトで**0件または1件**です。新しいモデルを昇格すると旧Productionは自動でArchivedになります。

**Q. Release IDとVersionの違いは何ですか**
A. Release ID（REL-0001形式）は昇格・Rollbackなど「リリース行為」1回ごとの識別子、Versionは配布物の版番号（Candidate=0.x、Production初回=1.0.0）です。RollbackではVersionは維持され、新しいRelease IDだけが発行されます。

**Q. TrOCRで学習したモデルはモデル管理画面に表示されますか**
A. 表示されます。TrOCRのモデル登録簿（`.trocr.json`）はTesseract/PaddleOCR（`.tess.json`/`.ocr.json`）とは別ファイル形式ですが、「モデル管理」画面の一覧・ダウンロード・削除に統合されています（「方式」列には「OCR認識」と表示されます）。TrOCRモデルの継続Fine-tune用選択は、学習画面自身の「登録済みモデルから選択」、モデル評価・Benchmark Runner画面の同様の選択欄からも引き続き利用できます。

## テンプレート・設定

**Q. プロジェクトテンプレートは後から変更できますか**
A. テンプレート自体を後から切り替える機能はありませんが、テンプレートが設定するのは初期値だけなので、作成後にすべての設定を個別に変更できます。

**Q. テンプレート設定は固定されますか**
A. 固定されません。作成後は通常のプロジェクトと同様に自由に変更できます。

**Q. 別PCで同じ設定を利用できますか**
A. サーバー側データ（画像・ラベル・モデル・実験/リリース記録）は同じBackendに接続すれば共有されます。一方、ブラウザ保存の設定（前処理UI設定・候補辞書・テンプレート記録・ウィザード完了状態）はPC・ブラウザごとに独立で、共有・エクスポート機能はありません。

**Q. localStorageに保存される情報は何ですか**
A. 前処理パラメータ・プリセット、候補辞書、テンプレート記録、Scientific Mode、サイドバー開閉状態、ウィザード完了状態などのUI設定です（キー一覧: [08_CONFIGURATION.md](08_CONFIGURATION.md)）。画像やラベルなどの成果物データは保存されません。

## セキュリティ・運用

**Q. PDFは外部サービスへ送信されますか**
A. 送信されません。PDFはローカルのmatplotlibで生成され、OCR Crafterは外部Webサービスへの通信を行いません（[SECURITY_AND_DATA_HANDLING.md](SECURITY_AND_DATA_HANDLING.md)）。

**Q. バックアップはどこへ保存されますか**
A. `data/backups/` に `BK-0001形式のID＋プロジェクトID＋モード＋日時` のZIPとして保存されます（[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)）。

**Q. JobがInterrupted（中断（再起動））になる理由は何ですか**
A. Jobの実行中にBackendが再起動されたためです。故障ではなく、実行中のまま固まるのを防ぐ仕様です。ジョブ管理画面から「再実行」できます。
