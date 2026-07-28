# [Investigation] TrOCR採用可否とOCR Crafter統合方式の調査

Issue: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## 背景

TrOCRは既存のTesseract、PaddleOCR、EasyOCRとは異なるモデル構造・学習方式・依存関係を持つ可能性があります。

そのため、本実装前にOCR Crafterの現在の構造へどのように統合できるかを確認します。

## 調査目的

以下を、コードおよび公式の一次資料に基づいて確認します。

- TrOCRの学習方式
- 推論方式
- ProcessorおよびTokenizerの扱い
- モデル保存形式
- チェックポイント形式
- CPU/GPU要件
- Windows対応
- OCR CrafterのDataset形式を利用できるか
- Evaluation Datasetを利用できるか
- Experiment Trackingへ記録すべき項目
- Model metadataへ記録すべき項目
- 既存Benchmarkへ統合できるか
- Engine Capabilityが必要か
- Recognizer Adapterが必要か
- 既存のengine条件分岐を拡張するだけで十分か
- 依存関係の競合可能性
- オフライン運用時のモデル管理方法
- ライセンスおよび配布時の注意点

## 調査対象

### OCR Crafter

- BackendのOCR engine選択処理
- Training処理
- Inference処理
- Evaluation処理
- Dataset Registry
- Experiment Tracker
- Model metadata
- Benchmark Runner
- Benchmark Center
- Frontendのengine選択UI
- 設定ファイル
- requirements
- テスト構成
- モデル保存ディレクトリ

### TrOCR

公式一次資料を優先してください。

- Microsoft ResearchによるTrOCR論文
- Hugging Face Transformers公式ドキュメント
- Hugging Faceの公式またはMicrosoft公開モデル情報
- Transformersの`VisionEncoderDecoderModel`
- `TrOCRProcessor`
- 公式ライブラリの学習・推論仕様

ブログや二次解説だけを根拠に結論を出さないでください。

## 調査対象外

- 本番コード実装
- UI実装
- API実装
- 学習実行
- 大容量モデルダウンロード
- 学習性能の本格比較
- 他Transformer OCRの実装

## 比較対象

最低限、以下の統合方式を比較してください。

### 案A

既存のengine条件分岐へTrOCRを追加する。

### 案B

共通Recognizer Adapterを導入する。

### 案C

Engine Capabilityだけ先に導入し、Adapter導入は必要箇所に限定する。

### 案D

TrOCR専用Backendとして追加し、将来の共通化は別Issueとする。

## 評価観点

- 既存コードへの変更量
- 回帰リスク
- 将来拡張性
- 学習処理の共通化可能性
- 推論処理の共通化可能性
- 評価処理の共通化可能性
- Frontendの分岐量
- API設計
- 永続化形式
- Dataset互換性
- Experiment互換性
- Model互換性
- Benchmark互換性
- テスト容易性
- Windowsでの導入性
- GPUなし環境での動作可能性
- パッケージサイズ
- オフライン運用
- ライセンス

## 成果物

- 現行アーキテクチャ調査結果
- TrOCR要件一覧
- 統合方式比較表
- 推奨方式
- 非推奨方式と理由
- 依存関係案
- metadata案
- API案
- UI影響範囲
- テスト方針
- 実装Issue分割案
- Architecture Decision

## 完了条件

- 既存実装の関連箇所を特定している
- TrOCRの公式仕様を確認している
- 統合方式を複数比較している
- 推奨方式を根拠付きで提示している
- 既存データ互換性への影響を確認している
- 実装Issueへ分割できる状態になっている
- 調査結果が`ARCHITECTURE_DRAFT.md`と`DECISION_LOG.md`へ反映されている
- EpicのIssue Mapを更新している

## 重要

このIssueでは本実装を開始しません。

調査中に簡易コードが必要になった場合も、リポジトリの本番コードへ追加せず、事前にユーザーへ確認してください。

## Parent Epic

Parent Epic: #1
