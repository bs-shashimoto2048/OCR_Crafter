# [Feature] TrOCR Backend単画像推論コア実装

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)

Phase3の実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase3「TrOCR Backend基盤」）。共通基盤（Engine Capability/Engine Registry/Model Metadata）はすべて完了済み。

## 実装結果（2026-07-30）

`src/app/services/trocr_engine.py`として実装済み。詳細は[TROCR_BACKEND.md](../../design/TROCR_BACKEND.md)を参照。要点:

- `TrOCREngine.load(model_ref, *, device=None, local_files_only=False)`でProcessor/Modelをロード
- `predict(image)`/`predict_file(path)`で単一画像の文字認識
- `AutoProcessor`/`VisionEncoderDecoderModel`を採用（理由は`TROCR_BACKEND.md`参照）
- device未指定時はCUDA自動判定、明示cuda指定かつ利用不可なら`TrOCRModelLoadError`（黙ってcpuへフォールバックしない）
- `TrOCRResult`はconfidence/bboxを持たない（捏造しない）
- transformersはoptional dependency（遅延import、未導入時は`TrOCRDependencyError`）
- OCR Pipeline・API・Frontend・Engine Registry・Model Metadataへの配線は行っていない

## 目的

TrOCR互換モデルをロードし、PIL画像または画像ファイルから単一画像の文字認識を実行できるBackendサービスを実装する。

## 事前調査結果（実装前に実施）

- **transformers依存**: 現時点でリポジトリに存在しない（`requirements.txt`・`requirements-ci.txt`とも0件、`pip show transformers`も未検出）。PyPI最新版`5.14.1`を確認し、これを追加する
- **safetensorsへの影響**: `transformers==5.14.1`は`safetensors>=0.8.0`を要求する。現行の`safetensors==0.7.0`（PaddleOCR等の間接依存として既存）は`0.8.0`へのバンプが必要（`torch`/`torchvision`は影響を受けない）
- **新規の間接依存**: `tokenizers`・`regex`（いずれもtransformersの必須依存、軽量なPythonライブラリでモデル重みのダウンロードを伴わない）
- **accelerate**: 単一デバイス推論では不要（transformers側の依存関係にも含まれない）。追加しない
- **Pillow**: `pillow==12.2.0`が既存。画像処理はPILのみで完結可能（OpenCV等の新規追加は不要）
- **既存device選択の再利用可否**: `train.py::detect_device()`はMPS/CPUのみ判定しCUDAを一切見ていないため、TrOCRの「CUDA利用可能→cuda」要件には再利用できない。TrOCR用に新規の自己完結したdevice解決ロジックを実装する
- **既存の遅延import・エラー変換パターン**: `predict.py::_get_easyocr_reader()`が`try: import easyocr / except ImportError as e: raise RuntimeError(...) from e`という明確な前例を持つ。TrOCRでも同じパターン（`TrOCRDependencyError`）を踏襲する
- **既存のテストmock慣習**: `unittest.mock.patch`ではなくpytestの`monkeypatch.setattr`/`monkeypatch.setitem`が一貫して使われている（`test_benchmark.py`/`test_yolo_detect.py`等）。TrOCRのテストも`monkeypatch`でHugging Face側のクラスメソッドを差し替え、実モデル・ネットワークを一切使わない
- **CIでのテスト方法**: transformersパッケージ自体（コードライブラリ）はネットワーク不要でimportでき、モデル重みのダウンロードだけがネットワークを要する。`AutoProcessor.from_pretrained`/`VisionEncoderDecoderModel.from_pretrained`を`monkeypatch`で差し替えることで、CI上でも実際のダウンロードなしにテストできる

## 今回の範囲

- transformers依存関係の追加（`requirements.txt`/`requirements-ci.txt`）
- optional dependencyとしての安全なimport（未導入でも既存Backendを壊さない）
- Processorロード（`AutoProcessor.from_pretrained`）
- VisionEncoderDecoderModelロード
- CPU/CUDAデバイス選択
- 単一画像推論
- 最小限の結果型
- エラーハンドリング
- モデルインスタンスの再利用（インスタンス単位、グローバルキャッシュなし）
- 単体テスト
- 設計ドキュメント更新

## 対象外

- OCR Pipelineへの接続
- API追加
- Frontend変更
- [Issue #12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)修正
- TrOCR学習
- TrOCR評価
- Benchmark統合
- Release Gate統合
- Model Metadata Adapter
- 既存モデル移行
- [Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)修正
- 実モデルのCIダウンロード

## Backend変更

`src/app/services/trocr_engine.py`を新規追加。既存ファイル（`ocr_pipeline.py`/`model_registry.py`/`predict.py`/`job_runner.py`/`ocr_evaluation.py`/`release_gate.py`/`benchmark.py`）は一切変更しない。

## API変更

なし

## UI変更

なし

## データ構造・永続化への影響

なし

## テスト観点

- 正常系: Processor/Modelロード、device移動、eval()、RGB変換、pixel_valuesのdevice移動、inference_mode内generate、skip_special_tokens=Trueでのdecode、同一インスタンスでの複数回predict時の再ロードなし、predict_file()
- 入力異常: model_ref/image=None・空文字・空白のみ・不正型・ファイル不存在・ディレクトリ指定・壊れた画像
- 依存・ロード異常: transformers未導入・Processor/Modelロード失敗・model.to()失敗・generate失敗・decode失敗
- device: 自動選択（CUDA有無）・cpu/cuda明示指定・cuda明示指定かつ利用不可・不正device
- 結果: 通常文字列・前後空白・空文字・不正decode結果
- 既存テストスイートに影響がない（[Issue #8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)起因の既知失敗を除く）

## 受け入れ条件

- [x] `TrOCREngine.load()`でProcessor/Modelをロードできる
- [x] `predict()`/`predict_file()`で単一画像の文字認識ができる
- [x] transformers未導入時に既存Backend起動・既存エンジンが壊れない
- [x] 明示的なcuda指定かつ利用不可の場合に黙ってcpuへフォールバックしない
- [x] confidence/bboxを捏造しない
- [x] 単体テストを追加し通過する（実モデル・ネットワーク不使用）
- [x] 既存コード・OCR Pipeline・API・Frontendを変更していない
- [x] 既存テストスイートに影響がない

## 補足資料

- [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
