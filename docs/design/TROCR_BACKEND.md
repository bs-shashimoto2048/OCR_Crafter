# TrOCR Backend 単画像推論コア 設計

Related: [ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](ENGINE_REGISTRY.md) / [MODEL_METADATA.md](MODEL_METADATA.md) / Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)（実装済み）

## 実装済み（2026-07-30）

`src/app/services/trocr_engine.py`として、Hugging Face Transformersを利用したTrOCRの**単画像推論コアのみ**を実装した（Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）。既存OCR Pipeline・API・Frontend・学習・評価・Benchmark・Release Gate・Model Metadataとは**まだ接続していない**（独立したBackendサービスとして実装のみ）。

**追記（2026-07-30、Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)）**: 実際の推論ディスパッチ（`src/app/predict.py::predict_from_image()`）からTrOCREngineを呼び出せるようになった。詳細は[FEATURE_PIPELINE_TROCR.md](../workitems/trocr/FEATURE_PIPELINE_TROCR.md)を参照。本ファイル下部の「OCR Pipelineとは未接続であること」はFeature #16時点の記述であり、`predict.py`については現在は接続済み（`trocr_engine.py`自体は無変更）。API・Frontend・学習・評価・Benchmark・Release Gate・Model Metadataとの接続は引き続き未実装。

**追記（2026-07-30、Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)）**: 既存OCR推論API（`POST /predict`）からもTrOCR推論を利用できるようになった。詳細は[FEATURE_TROCR_API_INTEGRATION.md](../workitems/trocr/FEATURE_TROCR_API_INTEGRATION.md)を参照。API経由の呼び出しはHugging Face Hubへアクセスする可能性がある（`local_files_only`は未公開）ため、社内運用ではローカルモデルパスの指定を推奨する。Frontend・学習・評価・Benchmark・Release Gate・Model Metadataとの接続は引き続き未実装。`trocr_engine.py`自体は無変更。

**追記（2026-07-30、Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)）**: Frontend（`InferenceView.jsx`、推論テスト画面）からもTrOCRを選択して`POST /predict`を呼び出せるようになった。詳細は[FEATURE_TROCR_FRONTEND_UI.md](../workitems/trocr/FEATURE_TROCR_FRONTEND_UI.md)を参照。モデル参照はUI側の自由入力欄からそのまま`model`フィールドへ渡るのみで、Model Metadata・Engine Registry APIとは引き続き未接続。`trocr_engine.py`・Backend API自体は無変更。

## 推論コアの責務

- TrOCR互換モデル（Processor・`VisionEncoderDecoderModel`）のロード
- CPU/CUDAデバイスの選択・モデルの当該デバイスへの移動
- PIL画像または画像ファイル1枚に対する文字認識（単一画像のみ）
- 同一インスタンスでのモデル・Processorの再利用

## 対象外

- OCR Pipelineへの接続（`predict.py`・`ocr_pipeline.py`等は無変更）
- API追加・Frontend変更
- TrOCR学習・評価
- Benchmark統合・Release Gate統合
- Model Metadata Adapter（`ModelMetadata`からの自動ロードは行わない）
- 既存モデルの移行
- 複数画像・バッチ推論
- mixed precision・dtype変更・beam search等のgenerate引数最適化
- MPS対応（必須ではないため見送り）

## `model_ref`

Hugging Face Hub上のmodel ID（例: `"microsoft/trocr-base-printed"`）、またはローカルディレクトリパスのいずれも、そのまま`from_pretrained()`へ渡せる文字列として扱う。**特定のmodel IDをコードへ既定値として固定しない**（`microsoft/trocr-*`を暗黙のデフォルトにしない）。`None`・空文字・空白のみは拒否し、前後空白は除去した上で使用する。

## `local_files_only`

`TrOCREngine.load()`の引数としてProcessor・Modelの両方の`from_pretrained()`へそのまま渡す。ネットワークへアクセスさせたくない場合（オフライン運用）に呼び出し側が明示的に指定する。

## Processor/Modelロード

- `transformers.AutoProcessor.from_pretrained(model_ref, local_files_only=...)`
- `transformers.VisionEncoderDecoderModel.from_pretrained(model_ref, local_files_only=...)`

`AutoProcessor`を採用した理由: `TrOCRProcessor`を直接使う案も検討したが、`AutoProcessor`は`model_ref`が指すモデルの`preprocessor_config.json`から適切なProcessorクラスを自動解決する、より汎用的かつHugging Face公式が推奨するロード方法である（[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)が想定する将来のFlorence等、TrOCR以外のVision-Encoder-Decoder系モデルにも同じロード経路で対応できる可能性が高い）。ProcessorとModelは必ず同じ`model_ref`から読み込む。

## device選択

- 未指定時: `torch.cuda.is_available()`が真なら`"cuda"`、そうでなければ`"cpu"`
- 明示指定: `"cpu"`・`"cuda"`・`"cuda:N"`のみ許可
- `"cuda"`系を明示指定したのにCUDAが利用不可の場合、**黙って`"cpu"`へフォールバックせず**`TrOCRModelLoadError`を送出する
- 不正なdevice文字列（`"gpu"`等）は`ValueError`
- 既存の`train.py::detect_device()`はMPS/CPUのみを判定しCUDAを一切見ないため、TrOCRの要件には再利用できず、本モジュール専用の`_resolve_device()`を新設した
- mixed precision・dtype自動変更・MPS対応は今回のスコープ外

## 単画像推論フロー

```python
rgb_image = image.convert("RGB")
pixel_values = processor(images=rgb_image, return_tensors="pt").pixel_values
pixel_values = pixel_values.to(device)
with torch.inference_mode():
    generated_ids = model.generate(pixel_values)
text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
```

`model`は`load()`時に`eval()`済み。前後空白は`strip()`で除去する。

## 結果型

```python
@dataclass(frozen=True)
class TrOCRResult:
    text: str
    engine_id: str = "trocr"
    model_ref: str | None = None
```

## confidenceを返さない理由

TrOCR標準の`model.generate()`は文字単位・単語単位のconfidenceスコアを直接返さない。[ARCHITECTURE_DRAFT.md](../workitems/trocr/ARCHITECTURE_DRAFT.md)の未解決事項として、confidence算出方法（`generate()`のスコア出力からの近似等）が残っており、今回のIssueのスコープではない。既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）のように実測値がある場合とは異なり、**推測・捏造した値を返すぐらいなら、confidenceフィールド自体を持たせない**という設計判断を取った。同様の理由でbboxも返さない（TrOCRは検出を行わない認識専用モデルのため）。

## optional dependency

`transformers`はモジュールのトップレベルではimportしない。`TrOCREngine.load()`内で`from transformers import AutoProcessor, VisionEncoderDecoderModel`を実行し、`ImportError`を`TrOCRDependencyError`（明確なpipインストール手順を含むメッセージ）へ変換する。これにより：

- `transformers`が未導入の環境でも、`trocr_engine.py`をimportしただけではエラーにならない（`import`時にモデルをロードしない設計とあわせ、既存のTesseract/PaddleOCR/EasyOCR処理やBackend起動には一切影響しない）
- 既存の`predict.py::_get_easyocr_reader()`（`try: import easyocr / except ImportError: raise RuntimeError(...)`）と同じパターンを踏襲している

## エラー設計

```text
TrOCRError（RuntimeError）
├── TrOCRDependencyError   transformers未導入
├── TrOCRModelLoadError    Processor/Modelロード失敗、deviceへの移動失敗、
│                          明示cuda指定かつ利用不可
└── TrOCRInferenceError    前処理/generate/decode失敗
```

単純な入力値不正（`model_ref`/`image`/`device`のNone・空文字・不正型等）は`ValueError`または`FileNotFoundError`とし、独自例外を増やしていない。例外メッセージには処理内容と`model_ref`を含めるが、内部オブジェクトやスタックトレース以上の情報は出力しない。

## モデルライフサイクル

`TrOCREngine`はグローバルSingleton・グローバルモデルキャッシュを持たない。`load()`で生成した1つのインスタンスの`predict()`/`predict_file()`を繰り返し呼ぶことで、Processor・Modelの再ロードを避ける（呼び出し側がインスタンスを保持する責任を持つ）。

## ネットワーク方針

`local_files_only=True`を指定すればHugging Face Hubへ一切アクセスしない。CI・テストでは実モデルのダウンロードを一切行わず、`transformers.AutoProcessor.from_pretrained`/`VisionEncoderDecoderModel.from_pretrained`をmonkeypatchで差し替えて検証する。

## Model Metadataとの将来接続点（未実装、設計メモのみ）

- 将来、`ModelMetadata.artifact_path`が指すローカルディレクトリを`model_ref`としてそのまま`TrOCREngine.load()`へ渡せる可能性が高い（`model_ref`はHugging Face Hub model IDとローカルパスの両方を受け付けるため）
- `ModelMetadata.engine_id="trocr"`は既存の`resolve_engine_id()`によるEngine Registry検証をそのまま通過する（`trocr`は既に組み込みエンジンとして登録済み）
- `ModelMetadata`から`TrOCREngine`を自動構築するAdapter・Factoryは本Issueでは実装しない。実装する場合は、`ModelMetadata`側の`extra`に保持されうるTrOCR固有情報（`processor`/`tokenizer`設定等、[MODEL_METADATA.md](MODEL_METADATA.md)で不採用とした項目）をどう扱うかも合わせて別Issueで検討する

## OCR Pipelineとは未接続であること（Feature #16時点。predict.pyはFeature #18で接続済み）

本Issue（Feature #16）の時点では、`src/app/services/ocr_pipeline.py`・`src/app/predict.py`・`src/app/job_runner.py`・`src/app/services/ocr_evaluation.py`・`src/app/services/release_gate.py`・`src/app/services/benchmark.py`は一切変更していなかった。`TrOCREngine`は独立したモジュールとして存在するのみで、既存の推論・学習・評価フローからは呼び出されなかった。

その後、Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)で`src/app/predict.py::predict_from_image()`のみが変更され、`resolve_engine_id()`経由で`engine="trocr"`のときに`TrOCREngine`を呼び出すようになった（`ocr_pipeline.py`・`job_runner.py`・`ocr_evaluation.py`・`release_gate.py`・`benchmark.py`は引き続き無変更）。詳細は[FEATURE_PIPELINE_TROCR.md](../workitems/trocr/FEATURE_PIPELINE_TROCR.md)を参照。

## Engine Registry / Engine Capabilityとの関係

`BUILTIN_CAPABILITIES`・組み込みRegistry定義・`resolve_engine_id()`の仕様は変更していない。`resolve_engine_id("trocr") == "trocr"`であることをテストで確認済み。RegistryからTrOCREngineを生成するFactoryは実装しない。
