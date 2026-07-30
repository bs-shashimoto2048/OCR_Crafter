# Engine Registry 設計

Related: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / [ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md) / Feature [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)（MVP実装済み）/ Refactor [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)（Backend初適用）

## MVP実装済み（2026-07-30）

本ドキュメントのうち、**`EngineDescriptor`と`EngineRegistry`の最小基盤のみ**を`src/app/services/engine_registry.py`として実装済み（Feature [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)）。

**実装されたAPI:**

- `EngineDescriptor`（frozen dataclass）: `engine_id` / `display_name` / `description` / `version` / `capability` / `implemented`
- `EngineRegistry`: `register()` / `unregister()` / `get()` / `list()` / `exists()`
- `create_default_registry()`: 既知4エンジン（tesseract/paddleocr/easyocr/trocr）を登録済みの新しい`EngineRegistry`インスタンスを返すfactory関数
- `resolve_engine_id()`（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)で追加）: rawな値（None・空文字・大文字混在・未登録値）から既知engine_idを解決する最小限の補助関数。前後空白のトリムと小文字化のみ正規化し、別名（alias）変換・未登録時の特定エンジンへの暗黙フォールバックは行わない。判定不能な場合は`None`を返す
- 例外: `InvalidEngineDescriptorError` / `EngineAlreadyRegisteredError` / `EngineNotFoundError`

**既存コードへの初適用（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)、Backend限定）:** `model_registry.py::list_model_infos()`と`ocr_pipeline.py::migrate_ocr_models_to_inference()`が、`resolve_engine_id()`経由でEngine Registryを利用するようになった。両箇所とも「`engine`未指定・不明ならPaddleOCRとみなす」という暗黙フォールバックを廃止し、未知の値は`"unknown"`として明示的に扱う。Frontend側の同型の暗黙フォールバック（`ModelsView.jsx::engineLabelOf()`・`inferenceModel.js::resolveInferenceEngine()`）は未対応のまま（[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)）。`predict.py`・`job_runner.py`・`ocr_evaluation.py`・`release_gate.py`・`services/benchmark.py`は引き続き未使用。

**今回未実装（本ドキュメントの将来構想のまま）:**

- `TrainingHandler` / `InferenceHandler` / `EvaluationHandler`
- `MetadataProvider` / `ModelLoader` / `Exporter` / `Validator`
- 遅延登録ラッパー（`_LazyTrainingHandler`等）・`AvailabilityChecker`
- `EngineConfiguration`（`config/settings.yaml`との連携）

**既存処理ではまだ利用していない**: `predict.py`・`job_runner.py`・`ocr_evaluation.py`・`model_registry.py`・`release_gate.py`・`services/benchmark.py`は本Issueで一切変更・参照していない。`Engine解決方法（Resolution）`節で述べた`release_gate.py`との重複解消も未着手。

**将来の段階的移行方針**: Handler群を導入する際は、まず`InferenceHandler`（`ENGINE_BUILDERS`と契約が一致する）から着手し、TrOCR等の新規エンジンの`register()`実装を通じて実証した上で、既存エンジンの移行要否を個別Issueで判断する（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase2以降）。モジュールレベルの共有Registryは持たせず、`create_default_registry()`を都度呼ぶ設計としたため、将来アプリへ配線する際は`main.py`の`startup`イベント等、呼び出し元1箇所で生成したインスタンスを明示的に受け渡す方式を想定する。

**`EngineDescriptor.version`について（レビューでの再検討、2026-07-30）**: 実装当初はPaddleOCR/EasyOCRについて`requirements.txt`記載のバージョンをDescriptorへ直接転記していたが、静的な文字列としてハードコードすると`requirements.txt`更新時に追従する保証が無く、気づかないまま実際のバージョンとずれる恐れがあるため、全エンジンとも`None`へ戻した。「実行環境に実際にインストールされているバージョン」を扱いたい場合は、登録時に値を書き写すのではなく、問い合わせ時に動的解決する仕組み（VersionResolver）、またはモデルインスタンス単位の実情報を扱う`MetadataProvider`側の責務とすべきと判断する。

## 将来検討事項

- **組み込みEngineの`unregister()`保護**: 現状の`EngineRegistry.unregister()`は、組み込み（`create_default_registry()`で登録した）エンジンかどうかを区別せず削除できる。本Issueの時点ではRegistryを既存処理から一切呼び出していないため実害は無いが、将来Registryを`predict.py`等の実処理へ配線する段階では、意図しない`unregister("tesseract")`のような呼び出しから組み込みエンジンを保護する必要が生じる可能性がある。その場合も保護ロジックはRegistry自体ではなく、呼び出し側（API層・配線層）に持たせる方針を維持しつつ、実装時に改めて要否を判断する。

## 目的

現在`predict.py`・`job_runner.py`・`ocr_evaluation.py`・`model_registry.py`・`release_gate.py`に散在する`if/elif`（またはファイル拡張子）によるエンジン判定を、**Registry（辞書ベースの解決機構）へ置き換えられるか**を検討し、置き換え可能な設計を示す。

**本設計もTrOCR専用ではない。** [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)と同様、PARSeq/ABINet/ViTSTR/SVTR/Florence/Qwen-VL OCR等、性質の異なる将来エンジンを見据えて設計する。

## 設計方針：既存コードは書き換えない（本Issueの範囲外）

本ドキュメントは**設計**であり、`predict.py`等の既存実装を今回書き換えるものではない（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)の案C方針どおり、既存3エンジンの動作コードは実装Issueでも変更しない）。Registryは**新規追加されるエンジン（TrOCR以降）から利用する**ものとして設計し、既存3エンジンをRegistryへ移行するかどうかは別途判断する（後述「既存コードとの対応表」参照）。

---

## コンポーネント設計

Python `typing.Protocol`（構造的部分型）で表現する。既存コードベースが軽量な関数・dict中心のスタイルであり、重厚なクラス階層を持たないことに合わせ、**継承ではなくProtocol（ダックタイピング）**を採用する。

### EngineDescriptor

Registryに登録される最小単位。1エンジン=1 EngineDescriptor。

```python
@dataclass(frozen=True)
class EngineDescriptor:
    capability: EngineCapability             # ENGINE_CAPABILITY.md のスキーマそのもの
    training_handler: TrainingHandler | None      # supports_training=False なら None
    inference_handler: InferenceHandler | None    # supports_inference=False なら None（通常は必須）
    evaluation_handler: EvaluationHandler | None  # supports_evaluation=False なら None
    metadata_provider: MetadataProvider
    model_loader: ModelLoader
    exporter: Exporter | None                # supports_export=False なら None
    validator: Validator
    configuration: EngineConfiguration
```

`training_handler`等が`None`になりうる設計は、[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)の対応するCapabilityフラグ（`supports_training`等）と必ず整合させる（Capability=`false`なのにHandlerが存在する／Capability=`true`なのにHandlerが`None`、という不整合を[Validator](#validator)が起動時に検査する）。

### EngineCapability

[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)で定義したスキーマそのもの。本ドキュメントでは参照のみ。

### TrainingHandler

```python
class TrainingHandler(Protocol):
    def build_job_payload(self, project_id: str, request: dict) -> dict:
        """学習リクエストからジョブ管理（job_manager.py）用のペイロードを構築する。"""
        ...

    def run_training(self, job_id: str) -> None:
        """ジョブワーカー（job_runner.py）から呼ばれる学習の実処理。"""
        ...
```

既存の`_run_ocr_training_job`（PaddleOCR）・`_run_tesseract_training_job`・`_run_training_job`（分類）を抽象化した形。TrOCRの`run_training`実装は、[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)で決定したとおりHugging Face `Seq2SeqTrainer`をラップする。

### InferenceHandler

```python
class InferenceHandler(Protocol):
    def recognize(self, image_path: str) -> RecognitionResult:
        """1画像を認識し、テキストと信頼度を返す。"""
        ...

@dataclass
class RecognitionResult:
    text: str
    confidence: float | None
    char_scores: list[float] | None = None   # supports_confidence=False なら None
```

**この`recognize(image_path) -> (text, confidence)`という形は、`services/benchmark.py`の`ENGINE_BUILDERS`が既に採用している契約と意図的に一致させている**（後述「ENGINE_BUILDERSとの整合性」参照）。

### EvaluationHandler

```python
class EvaluationHandler(Protocol):
    def evaluate(self, project_id: str, model: str, dataset: EvaluationDataset) -> EvaluationResult:
        """CER等の指標を算出する。既存 ocr_evaluation.py::evaluate_ocr の一般化。"""
        ...
```

現状`ocr_evaluation.py::build_recognizer`はTesseract専用（PaddleOCRは`# 将来:`コメントのまま未実装）。EvaluationHandlerを導入すれば、新エンジン追加時に「評価に対応するか」を`supports_evaluation`で宣言しつつ、対応する場合のみ実装すればよくなる。**ただし本Issueでは設計のみ。既存`ocr_evaluation.py`の書き換えは行わない。**

### MetadataProvider

```python
class MetadataProvider(Protocol):
    def build_metadata(self, training_result: dict) -> ModelMetadata:
        """学習結果からMODEL_METADATA.mdスキーマのレコードを構築する。"""
        ...

    def read_metadata(self, path: Path) -> ModelMetadata:
        """保存済みモデルのメタデータを読み込む。"""
        ...
```

[MODEL_METADATA.md](MODEL_METADATA.md)のスキーマを生成・読込する層。既存の`.tess.json`/`.ocr.json`の読み書きロジック（`tesseract_pipeline.py`・`ocr_pipeline.py`内の該当関数）に相当する。

### ModelLoader

```python
class ModelLoader(Protocol):
    def resolve(self, project_id: str, model_name: str) -> ResolvedModel:
        """モデル名からロード可能な実体（重みファイル・ディレクトリ等）を解決する。"""
        ...

    def load(self, resolved: ResolvedModel) -> Any:
        """実際にモデルをメモリへロードする（推論・評価で共用）。"""
        ...
```

既存の`resolve_ocr_model_meta`/`resolve_tesseract_model_meta`（`model_registry.py`）・`_load_checkpoint`（`predict.py`）に相当。TrOCRの場合は`VisionEncoderDecoderModel.from_pretrained(checkpoint_path)`を`load()`内部で呼ぶ想定。

### Exporter

```python
class Exporter(Protocol):
    def export(self, project_id: str, model_name: str, target_format: str) -> ExportResult:
        """推論用形式へのエクスポート。supports_export=False のエンジンには存在しない。"""
        ...
```

既存の`export_model.py`（PaddleOCR）相当の処理を一般化。

### Validator

```python
class Validator(Protocol):
    def validate_dataset(self, dataset: DatasetInfo) -> ValidationResult:
        """ENGINE_CAPABILITY.md の accepted_dataset_types/required_annotations と照合する。"""
        ...

    def validate_metadata(self, metadata: ModelMetadata) -> ValidationResult:
        """ENGINE_CAPABILITY.md の required_metadata を満たしているか検証する。"""
        ...
```

Engine CapabilityとModel Metadataの整合性を実行時に保証する層。**現状こうした検証は存在せず**（例えば`.ocr.json`に必須フィールドが欠けていても実行時までエラーにならないケースがある）、Validatorの導入自体が既存にない安全策の追加になる。

### EngineConfiguration

```python
@dataclass
class EngineConfiguration:
    settings_key: str          # config/settings.yaml内のこのエンジン用ブロックのキー名
    defaults: dict             # 未設定時のデフォルト値
```

**既存の`config/settings.yaml`は`training:`（分類）・`ocr_training:`（PaddleOCR）・`tesseract:`という、エンジンごとに異なる名前のトップレベルブロックを持つ（統一された`engines:`名前空間ではない）。** CLAUDE.mdの「既存キーの意味を変えない」原則により、**既存3ブロックの名前・構造は変更しない**。新規エンジン（TrOCR以降）は、新設する統一名前空間（例: `engines.trocr.*`）を使い、既存3エンジンは現状のブロックのまま据え置く、という**併存方針**を採る。将来的に既存3エンジンも統一名前空間へ移行するかは、既存プロジェクトへの互換性影響が大きいため本Issueでは判断しない（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase2以降で検討）。

### Factory（Registry本体）

```python
_ENGINE_REGISTRY: dict[str, EngineDescriptor] = {}

def register_engine(descriptor: EngineDescriptor) -> None:
    engine_id = descriptor.capability.engine_id
    if engine_id in _ENGINE_REGISTRY:
        raise ValueError(f"engine already registered: {engine_id}")
    _ENGINE_REGISTRY[engine_id] = descriptor

def get_engine(engine_id: str) -> EngineDescriptor:
    if engine_id not in _ENGINE_REGISTRY:
        raise ValueError(f"unknown engine: {engine_id}")
    return _ENGINE_REGISTRY[engine_id]

def list_engines() -> list[EngineCapability]:
    return [d.capability for d in _ENGINE_REGISTRY.values()]
```

`services/benchmark.py`の`ENGINE_BUILDERS`（`dict[str, Callable]`）と同じ「辞書ベースの解決」思想を、Backend全体（学習・推論・評価・メタデータ）へ拡張したもの。

### Registration方法

**遅延登録**を採用する。理由: 既存コードベースには「重量級ライブラリ（`paddleocr`/`easyocr`/`transformers`）は関数内で遅延importする」という確立された慣習があり（例: `predict.py::_get_easyocr_reader()`）、Registryもこの慣習に従うべきである。

```python
# src/app/services/engines/trocr.py（新設イメージ）
def _build_capability() -> EngineCapability:
    return EngineCapability(engine_id="trocr", ...)   # transformersをimportしない

def _build_training_handler() -> TrainingHandler:
    from transformers import Seq2SeqTrainer  # ここで初めてimport
    ...

def register() -> None:
    register_engine(EngineDescriptor(
        capability=_build_capability(),
        training_handler=_LazyTrainingHandler(_build_training_handler),  # 実際の呼出時までimportしない
        ...
    ))
```

各エンジンモジュールの`register()`をアプリ起動時（`main.py`の`startup`イベント）に1度だけ呼ぶ。Capability自体は軽量なdataclassのため即時構築してよいが、Handler実装は「実際に呼ばれるまで重量級ライブラリをimportしない」ラッパー（`_LazyTrainingHandler`等）を介する。

### Engine検索方法（Discovery）

「このエンジンは現在の実行環境で利用可能か」を判定する。既存の`services/benchmark.py::engine_catalog_with_availability()`（Tesseractバイナリ有無・`paddleocr` importable判定）を一般化する。

```python
class AvailabilityChecker(Protocol):
    def is_available(self) -> AvailabilityStatus:
        """バイナリ・ライブラリ・モデルファイルの有無を確認する（重い処理を避けるため
        importの成否など軽量なチェックに留める）。"""
        ...
```

`EngineDescriptor`に`availability_checker: AvailabilityChecker`を追加する案も検討したが、初版では`Validator`と役割が近いため統合を保留し、[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase1後半で改めて設計する。

### Engine解決方法（Resolution）

呼び出し側が`engine_id`文字列から`EngineDescriptor`を得る経路は`get_engine()`で単純だが、**既存データとの後方互換**が課題になる。既存の`.tess.json`/`.pt`ファイルは、必ずしも明示的な`engine`フィールドを持たない（Tesseract/分類モデルはハードコードで補完している、[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)/現状分析参照）。そのため解決ロジックは以下の優先順位を持つ。

1. モデルのMetadataに`engine`フィールドが明示されていれば、それを使って`get_engine(engine)`
2. 無ければ、ファイル拡張子から推定する**後方互換フォールバック**（`.tess.json`→`tesseract`、`.pt`→`custom`）を維持する
3. これは`release_gate.py::_model_engine()`が独自に持っていたロジックと同じ内容だが、**Registry側に一本化**し、`release_gate.py`はRegistryの解決結果を呼び出すだけにする（重複実装の解消）

---

## 既存コードとの対応表

| 現在の実装 | ファイル:関数 | 対応するRegistry概念 | 移行方針（本Issueでの結論） |
|---|---|---|---|
| 推論のエンジン分岐 | `predict.py::predict_from_image()` | `InferenceHandler.recognize()` | 既存3エンジンの分岐コードは**変更しない**。TrOCR等の新規分岐のみRegistry経由にする案を実装Issueで検討 |
| モデル評価のエンジン分岐 | `services/ocr_evaluation.py::build_recognizer()` | `EvaluationHandler.evaluate()` | 同上（Tesseract専用の現状維持。新規エンジンの評価対応可否は`supports_evaluation`で宣言） |
| 学習ジョブ振り分け | `job_runner.py` / `main.py::_spawn_training_runner` | `TrainingHandler.run_training()` | 同上。新規`job_type`（例: `"trocr"`）追加時にRegistry経由の分岐を1本追加する案 |
| モデル一覧・メタデータ解決 | `services/model_registry.py::list_model_infos()` | `MetadataProvider` / `ModelLoader` | 既存の`*.pt`/`*.ocr.json`/`*.tess.json`判定は**変更しない**。新規エンジンのファイル形式（例: TrOCRなら`*.trocr.json`案）はRegistry経由の`MetadataProvider`で読み込む |
| リリースGateのエンジン判定 | `services/release_gate.py::_model_engine()` | Engine解決方法（Resolution）の後方互換フォールバックと**完全に重複** | **本Issueで発見した重複実装。実装Issueで、Registryの解決ロジックへ一本化し、`_model_engine()`は廃止（動作は変えない、内部実装のみ統一）することを推奨する** |
| Benchmark Runner | `services/benchmark.py::ENGINE_BUILDERS`/`ENGINE_CATALOG` | Factory + InferenceHandlerの先行事例 | 次節で詳述 |

## Benchmark Runner（`ENGINE_BUILDERS`）との整合性

Investigationで確認したとおり、`ENGINE_BUILDERS`は本設計の`InferenceHandler`と**ほぼ同一の契約**（`builder(project_id, spec) -> {"label": str, "recognize": Callable[[str], tuple[str, float]]}`）を既に持っている。これは意図的な整合であり、以下の対応関係にある。

| `benchmark.py`の概念 | 本設計の対応概念 |
|---|---|
| `ENGINE_CATALOG`の1エントリ（`key`/`label`/`implemented`/`requires_model`/`profile_keys`） | `EngineCapability`のサブセット（`engine_id`/`display_name`/`supports_inference`/`supports_training`相当/`profile_keys`はTesseract固有のためCapabilityには一般化せず据え置き） |
| `ENGINE_BUILDERS[key](project_id, spec)`の戻り値`{"recognize": ...}` | `InferenceHandler.recognize()` |
| `engine_catalog_with_availability()` | Engine検索方法（Discovery）の`AvailabilityChecker`相当 |

**整合性の結論**: `ENGINE_BUILDERS`は本設計の**先行実装かつ縮小版**である。本Issueでは`benchmark.py`を書き換えず現状維持するが、将来Registryが実装された段階で、`benchmark.py`が独自に持つ`_build_tesseract_runner`等を廃止し、Registryの`InferenceHandler`を直接呼び出す形へ統合できる可能性がある（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase6「Benchmark」で検討）。ただし、これはBenchmark Runnerの既存動作を変える可能性があるため、**Investigationの完了条件である「既存OCRエンジンへ回帰がない」を厳格に検証できるまでは実施しない**。

---

## 現状

エンジンの解決ロジックが5+1箇所（本文書冒頭の対応表）に分散し、うち2箇所（`model_registry.py`と`release_gate.py`）は同じ「ファイル拡張子からengineを推定する」処理を独立に重複実装している。

## 課題

- 新規エンジン追加のたびに複数箇所への手作業での追加が必要（漏れのリスクは今回の調査で現実に確認済み）
- 重複実装（`release_gate.py`）は保守負債であり、Registryが無い限りこの種の重複は今後も増え続ける

## 設計案

上記のProtocol群 + 辞書ベースのFactory + 遅延登録という構成を提案する。

## メリット

- 新規エンジンの追加が「1つの`register()`関数を書く」作業に単純化される
- `release_gate.py`のような重複実装を、Registry一本化によって将来的に解消できる
- `ENGINE_BUILDERS`という既存の実証済みパターンとの整合性を保ちながら適用範囲を拡張できる

## デメリット

- Protocol/Factoryという抽象化層が1段増えるため、初めてこのコードを読む開発者（人間・AIエージェント問わず）にとって、既存の「素朴な`if/elif`」より学習コストが高くなる
- 既存3エンジンを無理にRegistryへ移行しようとすると[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)の回帰リスク方針と衝突するため、**当面は新旧2つの仕組みが並存する**状態が生まれ、それ自体が新たな複雑さになりうる

## 採用理由

`ENGINE_BUILDERS`という既に実証済みの設計と一貫性を保ちながら、Investigationで発見した具体的な重複・欠陥（`release_gate.py`の独立ロジック、`engineLabelOf()`のキャッチオール）を解消する現実的な経路であるため。

## 将来影響

- TrOCR以降のエンジン追加は、この設計に沿って`services/engines/<engine_id>.py`を1ファイル追加する形に収束していく想定
- 既存3エンジンをいつRegistryへ統合するかは、本Issueでは決定せず、[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase2（既存バグ修正）以降で個別に判断する
