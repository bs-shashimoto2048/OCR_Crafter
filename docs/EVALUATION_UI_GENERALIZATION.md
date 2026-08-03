# Evaluation UI Generalization

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59)（Evaluation UI Generalization Design） / [ENGINE_REGISTRY_DESIGN.md](ENGINE_REGISTRY_DESIGN.md) / [BENCHMARK_ENGINE_REGISTRY_DESIGN.md](BENCHMARK_ENGINE_REGISTRY_DESIGN.md) / ADR [0001](adr/ADR-0001_Trocr_Architecture.md)（TrOCR Architecture） / ADR [0002](adr/ADR-0002_Unified_Model_Metadata.md)（Unified Model Metadata） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR本体）

**本ドキュメントは調査・設計のみを対象とする。実装（Productionコード変更・Engine Registry変更・Models API変更・Backend変更・CSS変更・TrOCR実装・Evaluation実装）は一切行わない。**

**状態（2026-08-03）**: **Completed**。Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59)「Evaluation UI Generalization Design」として承認され、PR [#60](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/60)をSquash Merge・mainへ反映済み（Merge Commit: `ccb172d`、設計のみ・Productionコード変更なし）。評価関連の3画面（`OcrEvaluationView.jsx`/`BenchmarkView.jsx`/`BenchmarkCenterView.jsx`）は、責務・Engineの軸・依存API・Registry対応状況がいずれも異なり、単純な「Engine Registryへ置換するだけ」の移行では済まないことを確認した。本ドキュメントはその実態を整理し、段階的なMigration案とFuture Work候補を提示する。

以下が確定した設計判断である。

- `OcrEvaluationView.jsx`はTesseract専用のモデル単体評価画面（Engine軸自体が存在しない）
- `BenchmarkView.jsx`はBenchmark Variant Key軸の実行画面
- `BenchmarkCenterView.jsx`はcanonical Engine ID軸の結果閲覧画面（既に5Engine表示可能、Refactor #57で対応済み）
- **3画面は責務・データ軸が異なるため、無理に統合しない**（各画面の役割は維持し、個別に一般化する）
- `OcrEvaluationView.jsx`の一般化には、Backend評価API（`POST /api/ocr/evaluate`）のマルチEngine対応が前提として必要（whitelist/PSM等のTesseract固有機能はEngine Registryのデータでは代替できない）
- TrOCR Evaluation UIは、Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)配下のBackend Evaluation API対応が完了した後に実施する
- 本Epic（#46）の「Evaluation UI Implementation」は、Epic #27配下のMulti-engine Evaluation API設計・実装完了後まで**依存待ち（⏸）**とする
- **Epic間の責務境界**: Evaluation UIの見た目・画面責務の一般化はEpic #46、Evaluation Backend（Dispatcher・TrOCR対応）はEpic #27の責務。TrOCR本体の学習・推論はEpic #27、Engine Registry・UI側のデータ駆動化はEpic #46のまま維持する

次のDesign Issueとして、Epic #27配下に[Design] Multi-engine Evaluation API Architectureを作成し、Backend評価API側の設計から着手する。

---

## 1. 現状構成

評価に関わる画面は3つ独立して存在し、状態共有はない（いずれも`App.jsx`から独立してレンダリングされる）。

| 画面 | ファイル | 目的 | Engineの軸 | 実行有無 |
|---|---|---|---|---|
| モデル評価 | `frontend/src/views/OcrEvaluationView.jsx`（908行） | Tesseractモデル1件を指定データセットで評価し、学習前後の精度差・文字混同・画像単位の誤認識を詳細に確認する | 軸なし（**Tesseractのみ暗黙固定**） | あり（`/api/ocr/evaluate`） |
| Benchmark Runner | `frontend/src/views/BenchmarkView.jsx`（593行） | 複数Engineのモデルをまとめて実行し、CER/精度/速度で比較するベンチマークをその場で実行する | Backend `ENGINE_CATALOG`の**Benchmark Variant Key** | あり（`onRun`経由で`POST /api/benchmarks`） |
| Benchmark Center | `frontend/src/views/BenchmarkCenterView.jsx`（601行） | プロジェクト内の既存モデル・評価結果を横断的に閲覧・比較する（新規実行なし） | Model Registryの**canonical Engine ID** | なし（読み取り専用） |

`BenchmarkView.jsx`と`BenchmarkCenterView.jsx`の2画面の軸の違い（Variant Key vs canonical Engine ID）は[BENCHMARK_ENGINE_REGISTRY_DESIGN.md](BENCHMARK_ENGINE_REGISTRY_DESIGN.md)で既に確定した設計判断である。本ドキュメントはここに`OcrEvaluationView.jsx`を加えた**3画面・実質3種類のEngine軸**を扱う。

---

## 2. UI責務

### 2.1 画面ごとの責務分類

要求された分類（モデル単体評価／ベンチマーク実行／評価結果閲覧／比較／履歴／ランキング）で整理すると、3画面はいずれも単一責務ではなく複数責務が混在している。

| 画面 | モデル単体評価 | ベンチマーク実行 | 評価結果閲覧 | 比較 | 履歴 | ランキング |
|---|---|---|---|---|---|---|
| `OcrEvaluationView.jsx` | ✅（主機能） | — | ✅ | ✅（学習前後の差分） | ✅（フラットな評価履歴テーブル） | △（文字混同ランキングのみ。モデル間ランキングではない） |
| `BenchmarkView.jsx` | — | ✅（主機能、`onRun`経由） | ✅（Leaderboard詳細） | ✅（A/B履歴比較） | ✅（実行済みJobの履歴一覧） | ✅（CER順Leaderboard） |
| `BenchmarkCenterView.jsx` | — | — | ✅（主機能） | ✅（比較テーブル・レーダーチャート） | △（保存済み「比較設定」の履歴。実行履歴ではない） | △（モデル推奨の算出はあるが、Leaderboardのような順位表ではない） |

### 2.2 各画面の詳細

**`OcrEvaluationView.jsx`**: データセット選択・前処理モード選択・画像ディレクトリ/GT CSVの手動指定・モデル選択（学習前`eng.traineddata`＋学習済みモデル）・評価対象文字（whitelist）設定・実行ボタン・フラットな評価履歴テーブルを左パネルに、結果サマリー・CER/文字一致率/完全一致率と学習前後の差分・文字混同ランキング・モデル別サマリー・画像単位の誤認識テーブルを右パネルに持つ。コンポーネント自身が呼ぶAPIは前処理プレビュー系のみ（`/image-builder/evaluation/directory-images`、`/api/ocr/training-preprocess/preview`、`/api/ocr/preview-file/batch`）。**実際の評価実行（`onRun`）は`App.jsx:3699`にあり**、`POST /api/ocr/evaluate`へ`targets: [{ engine: "tesseract", model }]`を固定送信する。

**`BenchmarkView.jsx`**: 実行設定フォーム（Variant Keyチェックボックス・モデル選択・前処理選択）＋実行ボタン（`onRun`委譲）＋履歴テーブル（A/B選択用ラジオボタン付き）＋詳細/Leaderboard表示（CER順ランキング・画像単位ケース比較）＋バランス重み編集を1画面に持つ。コンポーネント自身が呼ぶAPIはBenchmark詳細取得（`GET /api/benchmarks/{id}`）とCSVエクスポートのみで、実行・履歴取得・重み更新はいずれも親コンポーネント（`App.jsx`）へ委譲されている。

**`BenchmarkCenterView.jsx`**: 既存モデル・評価結果の横断比較専用（画面上部に「評価は実行しません」と明記）。フィルタ（Dataset/Engine/前処理Version/Experiment/フリーテキスト）・一覧テーブル・比較テーブル・レーダーチャート/トレンドチャート・CSV/Markdown/JSONエクスポート・保存済み「比較設定」の履歴カードを持つ。`GET /api/benchmark-center/models`（`list_comparable_models()`）が唯一のデータ源で、比較・チャートはすべてクライアント側で構築される。

### 2.3 UI導線評価（ユーザー視点）

- **分かりにくい点**: 「学習したモデルの精度を確認したい」というユーザーの目的に対し、どの画面を使うべきかが画面名からは判断しづらい。`OcrEvaluationView`はTesseract限定の深い1件評価、`BenchmarkView`は複数Engine横断のその場実行、`BenchmarkCenterView`は既存結果の横断閲覧、という使い分けは実装を読まないと分からない。
- **重複している点**: 「評価を実行して結果を見る」という体験が`OcrEvaluationView`（Tesseract専用、`/api/ocr/evaluate`）と`BenchmarkView`（複数Engine、`/api/benchmarks`→Job）の2つの独立した実行経路に分かれている。両者は同じ「1回評価を実行する」という概念でありながら、データモデル・API・保存先（フラット履歴 vs Job/Benchmarkレコード）が異なり、相互運用性がない。また「履歴」の概念も、`BenchmarkView`は実行Jobの履歴、`BenchmarkCenterView`は保存済み比較設定の履歴と、同じ言葉で異なるものを指している。
- **統合できるか**: 3画面を1画面へ統合するのはリスクが高く推奨しない。`OcrEvaluationView`のwhitelist/PSM設定はTesseract固有機能で他Engineに等価概念がなく、`BenchmarkView`のVariant Key軸は`BenchmarkCenterView`のcanonical Engine ID軸と構造的に異なる（[BENCHMARK_ENGINE_REGISTRY_DESIGN.md](BENCHMARK_ENGINE_REGISTRY_DESIGN.md)で既に確定）。統合ではなく、**各画面の責務を明確化した上で個別に一般化する**方針が妥当と判断する（8章参照）。

---

## 3. Engine責務（Engine対応状況）

| 画面 | Tesseract | PaddleOCR | EasyOCR | TrOCR | Custom |
|---|---|---|---|---|---|
| `OcrEvaluationView.jsx` | ✅（唯一の対応） | ❌ | ❌ | ❌ | ❌ |
| `BenchmarkView.jsx` | ✅（`tesseract_model`/`tesseract_base`の2 Variant） | ✅（`paddleocr_official`/`paddleocr_custom`の2 Variant） | △（カタログに存在するが`implemented: False`で無効表示、実行不可） | ❌（カタログにエントリ自体が存在しない） | —（該当概念なし。`paddleocr_custom`はモデル取得元のVariantでありCustom Engineではない） |
| `BenchmarkCenterView.jsx` | ✅ | ✅ | ✅ | ✅ | ✅（Refactor #57で全Engine均一対応済み・データ駆動） |

`OcrEvaluationView.jsx`はEngine概念自体を持たない（`if (engine === ...)`のような分岐が一つも無い）。これは「他Engineへの分岐が未実装」なのではなく、**画面全体が暗黙にTesseractを前提として書かれている**ことを意味する（モデルpropが`tesseractModels`という名前である時点でEngine非依存の設計になっていない）。

---

## 4. Registry責務（Engine依存コードの抽出とRegistry移行可能性）

Engine Registry（`frontend/src/config/engineRegistry.js`）は静的なEngineごとの表示・学習可否・対応デバイス等の**データのみ**を扱う設計であり、既存の`getEngineLabel()`等の公開APIは全て「文字列→静的値」の変換に限定される。以下、各画面のEngine依存コードを移行可能性で分類する。

### 4.1 `OcrEvaluationView.jsx`

| 箇所 | 内容 | 判定 |
|---|---|---|
| `OcrEvaluationView.jsx:565,568-569` | `eng.traineddata`をTesseract標準英語モデルとして表示するラベル文言 | **移行可能**（`getEngineDisplayName()`等でラベル文言化できる、データのみ） |
| `OcrEvaluationView.jsx:582` | 「学習済みTesseractモデルがありません」という固定文言 | **移行可能**（`getEngineLabel()`でテンプレート化できる） |
| `OcrEvaluationView.jsx:35,86-90,575-581` | `tesseractModels`という命名のprop | 移行不可（Registryのデータ問題ではなく、`App.jsx`とのprop構造自体の作り直しが必要） |
| `OcrEvaluationView.jsx:587-609` | whitelist（評価対象文字）設定UI | **移行不可**。Tesseract推論固有の制約であり、PaddleOCR/EasyOCR/TrOCRに等価APIが無い。Registryへ「この機能をサポートするか」という真偽値フラグ（データ）を持たせることは可能だが、機能自体の実装はRegistryでは代替できない |
| `App.jsx:3674,3676` | `targets.push({ engine: "tesseract", model })`のハードコード | **移行不可**。Engine選択UIそのものが存在しないため、コード改修（実装Feature）が必要 |
| `App.jsx:3689-3695` | `charset`（whitelist）・`psm: 7`のTesseract固有パラメータ送信 | **移行不可**。PSM（ページ分割モード）はTesseract固有概念でRegistryのデータ化になじまない |

### 4.2 `BenchmarkView.jsx`

| 箇所 | 内容 | 判定 |
|---|---|---|
| `BenchmarkView.jsx:75,79` | `.tess.json`/`.ocr.json`の拡張子フィルタ | 部分的に移行可能（Registryへ`modelFileExtension`相当のフィールドを追加すれば一部移行可能。未実施） |
| `BenchmarkView.jsx:97-98,100-101,103-104,106-107` | `selectedEngines.tesseract_model`等、Variant Keyでの`if`分岐（実行payload構築） | **移行不可**。Variant Key軸（モデル取得元）はcanonical Engine ID軸のRegistryでは表現できない（[BENCHMARK_ENGINE_REGISTRY_DESIGN.md](BENCHMARK_ENGINE_REGISTRY_DESIGN.md)の設計判断どおり） |
| `BenchmarkView.jsx:231` | `engine.implemented && engine.available`によるチェックボックス活性判定 | **既にデータ駆動**（Backend `ENGINE_CATALOG`のフラグをそのまま利用しており、ハードコードなし。参考にすべき良いパターン） |
| `BenchmarkView.jsx:252,262` | `engine.key === "tesseract_model"` / `"paddleocr_custom"`によるモデルピッカー表示切替 | **移行不可**（Variant Key文字列比較。Registryが持つのはEngine ID単位の情報であり、Variant単位のサブUI制御には使えない） |

### 4.3 `BenchmarkCenterView.jsx`

Refactor #57により、Engine表示に関するコードは全て`engineDisplayText()`（`getEngineLabel() ?? "不明"`）経由に統一済みで、**残存するEngine依存コードは無い**。`engineOptions`（フィルタ選択肢）は`row.engine`から動的導出されており、ハードコードされたEngine一覧を持たない（ただし表示順は生値のアルファベット順であり、Registryの`listEngineIds()`のような意図的な順序ではない——4.4章で軽微な改善余地として記録）。

### 4.4 その他の軽微な所見

- `BenchmarkCenterView.jsx`のEngineフィルタ選択肢は`row.engine`のアルファベット順ソートであり、`getTrainingSelectableEngines()`等が持つような意図的な表示順ではない。優先度は低いが、統一する余地がある（9章Future Work）。

---

## 5. Models API責務

Epic #28（ADR-0002）で設計された統一モデルメタデータ（`ModelMetadata`、`engine_id`はcanonical Engine ID、`resolve_engine_id()`で正規化）は、**サービス層（`src/app/services/models_api.py`の`ModelsAPI`ファサード）には存在するが、HTTPエンドポイントへの配線が一切行われていない**（`main.py`に`ModelsAPI`を参照するルートは存在せず、`docs/06_API_REFERENCE.md`にも「Models API」セクションは無く、旧来の「モデル管理」セクションのみが存在する）。ADR-0002自身も「既存`/models/info`等への配線は行わず、既存エンドポイントは無変更のまま維持」と明記しており、Epic #28はUIレビュー待ちで一時停止中である。

したがって、**3画面のいずれもModels APIを直接利用していない**。

| 画面 | 実際に利用しているAPI | Models APIとの関係 |
|---|---|---|
| `OcrEvaluationView.jsx` | `/models`・`/models/info`・`/model-types`・`/api/ocr/models/official`（いずれも`App.jsx`が取得し、`tesseractModels`/`modelInfos`propとして渡す。ADR-0002以前の旧`list_model_infos()`経路） | 旧API依存。Models API未使用 |
| `BenchmarkView.jsx` | `ocrModels`propを親から受け取り、拡張子でクライアント側フィルタ（画面自体はAPIを呼ばない） | 旧API依存（間接的）。Models API未使用 |
| `BenchmarkCenterView.jsx` | `GET /api/benchmark-center/models`（Benchmark Center専用。`list_comparable_models()`が`model_registry.py`経由で`resolve_engine_id()`により正規化済みの`engine`を返す） | Models APIそのものではないが、**canonical Engine IDという点でADR-0002と同じ軸**を既に採用している |

**不足フィールド**: Models APIがHTTPエンドポイントとして存在しないため、現時点でどの画面も「切替」はできない。仮に将来Evaluation画面をModels API経由へ移行する場合（ADR-0002の4フェーズ移行のPhase 3「Evaluation」に相当、**未着手**）、`OcrEvaluationView.jsx`が必要とするTesseract固有情報（whitelist対応可否、baseline traineddataの扱い等）は`ModelMetadata`の現行スキーマには無く、追加フィールドの設計が別途必要になる。

---

## 6. Backend責務

- **`ENGINE_CATALOG`**（`src/app/services/benchmark.py:44-85`）: `trocr`エントリは依然として存在せず、`easyocr`は`implemented: False`のまま（無変更を確認）。
- **評価専用エンドポイント**: `POST /api/ocr/evaluate`（`main.py:4757-4789`、`evaluate_ocr()`）は**Tesseract専用**。リクエストスキーマ`OcrEvalTarget.engine`（`schemas.py:231`）は既定値`"tesseract"`で、docstringも「評価エンジン（現状 tesseract）」と明記。ディスパッチャ`build_recognizer()`（`ocr_evaluation.py:133-140`）は`engine == "tesseract"`以外を`ValueError`で拒否し、コード中に`# 将来: elif engine == "paddleocr": ...`という将来対応コメントが既に存在する。`charset`（whitelist）・`psm`はTesseract固有パラメータ。
- **Benchmark系エンドポイント**: `GET /api/benchmarks/engines`（カタログ+可用性）、`POST/GET /api/benchmarks`（Job作成・一覧・詳細・Export）、`GET/POST /api/benchmark-center/*`（既存の`experiment_tracker.py`記録の閲覧・保存のみで、評価自体は実行しない）。
- **Models API**: `ModelsAPI`ファサードはサービス層に実装済みだが、HTTPルートへの配線は無い（5章参照）。

---

## 7. TrOCR対応時の必要改修（層別）

| 層 | 必要な改修 | 備考 |
|---|---|---|
| **Backend** | `ENGINE_CATALOG`（`benchmark.py`）へ`trocr`エントリ追加／`ocr_evaluation.py:build_recognizer()`へ`elif engine == "trocr"`分岐追加／`OcrEvalTarget`スキーマがTesseract固有パラメータ（`charset`/`psm`）を必須としない形へ整理 | ADR-0001は「Benchmark: `ENGINE_BUILDERS`/`ENGINE_CATALOG`への追加登録のみで、Benchmark Center側の変更は不要」と明記。一方「モデル評価画面（`ocr_evaluation.py`）のTrOCR対応は未解決のまま次フェーズへ持ち越す」とも明記しており、Evaluation側の改修は本Featureの範囲外の大きめの作業として残る |
| **Frontend** | `OcrEvaluationView.jsx`へEngine選択UI追加（現状は選択UI自体が存在しない）＋whitelist/PSM UIをEngine別に条件表示化／`BenchmarkView.jsx`へ`trocr` Variant Key行追加（`engines.map()`は既に汎用ループのため、Backendカタログに追加されれば表示は自動追随。モデルピッカーが必要か否かは別途判断） | `BenchmarkCenterView.jsx`は無改修（既にRegistry経由でTrOCRを表示可能、Refactor #57で対応済み） |
| **Engine Registry** | 追加フィールドの要否を判断（例: `supportsWhitelist`/`supportsPsm`/`modelFileExtension`等）。`trocr`エントリ自体は既に`engineRegistry.js`に存在し、表示名・学習可否等は移行済み | 新規フィールド追加は「Evaluation Registry」（9章Future Work）として別途設計すべきで、本ドキュメントでは決定しない |
| **Models API** | Evaluation向けにModels APIをHTTPエンドポイントとして配線する場合、ADR-0002 Phase 3「Evaluation」の着手が前提 | 現状未着手。TrOCR対応の前提条件ではないが、`OcrEvaluationView.jsx`のモデル一覧を旧APIから移行する場合は関係してくる |
| **Evaluation API** | `/api/ocr/evaluate`のマルチEngine対応（上記Backend参照）が最大の作業。TrOCRの信頼度スコア計算等、Tesseractとは異なる出力構造への対応も必要 | ADR-0001でも未解決事項として明記されている |

TrOCR自体の実装（学習・推論本体）はEpic #27の責務であり、本ドキュメントはEvaluation UI側の受け入れ改修のみを対象とする。

---

## 8. Architectureとの整合

- **[ENGINE_REGISTRY_DESIGN.md](ENGINE_REGISTRY_DESIGN.md)**: `engineRegistry.js`は静的Engine情報（表示・学習可否・デバイス対応等）の一元化を目的とし、`trocr`エントリは既に存在する。本ドキュメントの分析はこの前提と矛盾しない——`OcrEvaluationView.jsx`のwhitelist/PSMのような「Registryのデータでは代替できない機能差」がある、という新たな知見を追加するのみである。
- **[BENCHMARK_ENGINE_REGISTRY_DESIGN.md](BENCHMARK_ENGINE_REGISTRY_DESIGN.md)**: `BenchmarkView.jsx`のVariant Key軸と`BenchmarkCenterView.jsx`のcanonical Engine ID軸の区別は、既に確定した設計判断としてそのまま踏襲した。本ドキュメントはこれに`OcrEvaluationView.jsx`の「軸そのものが存在しない（Tesseract固定）」という第3のケースを追加した。
- **ADR-0002（Unified Model Metadata）**: バックエンドの`ModelMetadata`/`resolve_engine_id()`（canonical Engine ID軸）とフロントエンドの`engineRegistry.js`は別軸であり、互いの変更を要求しないと明記されている（ADR-0002 Related Documents節）。本ドキュメントの調査はこれと整合しており、Models APIが未配線であることを追加で確認した。ADR-0002の4フェーズ移行計画（Adapter → 新規書き込みのみ → Consumer別切替[Models→Inference→**Evaluation**→Deployment/Release Gate] → 旧経路撤去）において、Evaluationは Phase 3 に位置づけられており未着手であることを確認した。
- **ADR-0001（TrOCR Architecture）**: Benchmark（Runner）へのTrOCR対応はカタログ登録のみで済むとされる一方、モデル評価画面（Evaluation）のTrOCR対応は明示的に未解決事項として次フェーズへ持ち越されている。本ドキュメントの7章はこの前提を踏襲し、Evaluation側の改修をTrOCR対応の主要な残作業として位置づけた。

矛盾は見つからなかった。

---

## 9. 問題点（まとめ）

1. **3画面が異なるEngine軸を持つ**: Variant Key（Runner）／canonical Engine ID（Center）／軸なし・Tesseract固定（Evaluation）が並存し、Registry一つで統一的に解決できない。
2. **「評価を実行する」体験が2つの独立経路に分裂**: `OcrEvaluationView`（Tesseract専用、`/api/ocr/evaluate`）と`BenchmarkView`（複数Engine、`/api/benchmarks`）が別データモデル・別保存先を持ち、相互運用性がない。
3. **Models APIが実質未稼働**: ADR-0002で設計された統一モデルメタデータはHTTPエンドポイントへ配線されておらず、3画面とも旧APIに依存している。
4. **TrOCR対応の最大のボトルネックはEvaluation Backend**: `ocr_evaluation.py`のTesseract専用ディスパッチャがADR-0001でも未解決事項として明記されている。
5. **UI導線の重複・不明瞭さ**: どの画面をいつ使うべきかが画面名・実装からしか判断できず、「履歴」「比較」という同じ言葉が画面ごとに異なる意味を持つ。

---

## 10. 段階的Migration案

Epic #28・Epic #46で踏襲してきた「1度に全画面を移行しない」方針を継続する。以下は実装Feature着手時の参考順位（本Designでは着手しない）。

| 優先度 | 対象 | 内容 | 理由 |
|---|---|---|---|
| 1 | `BenchmarkCenterView.jsx`のEngineフィルタ表示順統一（軽微） | `listEngineIds()`順への統一 | 既にRegistry移行済みで最小リスク・即着手可能 |
| 2 | Evaluation Registry設計（小規模スパイク） | `supportsWhitelist`/`supportsPsm`等、Evaluation固有のEngine capabilityフラグをどこに持たせるか（`engineRegistry.js`拡張 or 別モジュール）を決定 | 後続の`OcrEvaluationView`一般化・Backend改修の前提となる設計判断 |
| 3 | Backend `POST /api/ocr/evaluate`のマルチEngine対応 | `build_recognizer()`へPaddleOCR/EasyOCR分岐を追加（TrOCRはEpic #27待ち） | UIより先にBackendが対応しないとFrontend側のEngine選択UIが意味を持たない |
| 4 | `OcrEvaluationView.jsx`のEngine選択UI追加・ラベルRegistry化 | `tesseractModels`固定propの一般化、whitelist/PSMのEngine別条件表示 | 影響範囲が大きく、Backend対応完了後に着手すべき |
| 5 | `BenchmarkView.jsx`への`trocr` Variant Key対応 | Backend `ENGINE_CATALOG`へのエントリ追加に追随するのみ（画面側は`engines.map()`が既に汎用） | Epic #27（TrOCR本体）のBackend対応が前提 |
| 6（低優先） | UI導線改善（画面名・説明文の明確化、重複概念の整理） | 3画面の役割をユーザーへ明示する説明文追加 | 実装コストは低いが、他の改修と合わせて計画すべき |

---

## 11. Future Work（後続Issue候補）

- **Evaluation Registry**: Evaluation画面固有のEngine capability（whitelist対応可否・PSM対応可否・モデル拡張子等）をどこに持たせるかの設計・実装。`engineRegistry.js`への拡張か、独立モジュールかを検討する。
- **OcrEvaluationView Generalization**: Tesseract固定の画面をマルチEngine対応へ一般化する（Engine選択UI追加・`tesseractModels`propの一般化・whitelist/PSMの条件表示）。Backend `POST /api/ocr/evaluate`のマルチEngine対応が前提。
- **BenchmarkView Cleanup**: `.tess.json`/`.ocr.json`拡張子フィルタのRegistry化検討、`trocr` Variant Key追加（Backend対応後）。Variant Key構造自体は変更しない。
- **BenchmarkCenter Cleanup**: Engineフィルタの表示順を`listEngineIds()`に統一する等の軽微な改善。
- **TrOCR Evaluation UI**: 上記を組み合わせた、TrOCRを実際に評価できるようにする機能追加（Epic #27・Epic #46・本Designの複数成果に依存する統合Feature）。
- **Evaluation API Migration**: `/api/ocr/evaluate`・関連モデル一覧取得をADR-0002のModels API（Phase 3: Evaluation）へ移行する。Models APIのHTTPエンドポイント配線自体もこの一部として必要になる。

---

## 12. Scope外

- Productionコードの変更（3画面・`App.jsx`・Backend・Engine Registry・Models API）
- TrOCR機能の実装（Epic #27の責務）
- Evaluation機能の実装・改修
- Models APIのHTTPエンドポイント配線
- CSSレイアウトの変更
- 本ドキュメントで挙げたFuture Work項目の着手（いずれも別Issueで判断する）
